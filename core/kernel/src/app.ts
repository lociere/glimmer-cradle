/**
 * Kernel 应用根。
 *
 * `App` 只负责生命周期阶段编排；跨层组装细节下沉到
 * `core/lifecycle/runtime/*` 这些 app-root delegate，避免根入口退化成长脚本。
 */
import process from 'node:process';
import { ErrorCode } from '@glimmer-cradle/protocol';
import {
  AppStartedEvent,
  AppStartingEvent,
  AppStoppedEvent,
  AppStoppingEvent,
} from './foundation/event-bus/events';
import { CoreException } from './foundation/exceptions';
import { createTraceContext } from './foundation/logger/trace-context';
import { AppLifecycleState } from './lifecycle/lifecycle-state.enum';
import { closeLogger, getLogger } from './foundation/logger/logger';
import { histogram } from './foundation/logger/metrics';
import { EventBus } from './foundation/event-bus/event-bus';
import { LifecycleOrchestrator } from './lifecycle/runtime/lifecycle-orchestrator';
import { FoundationRuntime } from './lifecycle/runtime/foundation-runtime';
import { KernelTransportRuntime } from './lifecycle/runtime/kernel-transport-runtime';
import { CognitionRuntime } from './lifecycle/runtime/cognition-runtime';
import { AudioRuntime } from './lifecycle/runtime/audio-runtime';
import { ApplicationRuntime } from './lifecycle/runtime/application-runtime';
import { ExtensionRuntime } from './lifecycle/runtime/extension-runtime';
import { AvatarRuntime } from './lifecycle/runtime/avatar-runtime';
import { PresentationRuntime } from './lifecycle/runtime/presentation-runtime';
import { OrganismRuntime } from './lifecycle/runtime/organism-runtime';
import { loadProductComposition } from './composition/product-composition';
import { currentExtensionPlatform } from './application/skill-plane/availability';

const logger = getLogger('app-root');

export class App {
  private static _instance: App | null = null;
  private _state: AppLifecycleState = AppLifecycleState.UNINITIALIZED;
  private _startupTimeMs = 0;
  private _orchestrator: LifecycleOrchestrator | null = null;
  private _transportRuntime: KernelTransportRuntime | null = null;

  public static get instance(): App {
    if (!App._instance) {
      App._instance = new App();
    }
    return App._instance;
  }

  private constructor() {}

  public get state(): AppLifecycleState {
    return this._state;
  }

  public async start(): Promise<void> {
    if (this._state !== AppLifecycleState.UNINITIALIZED && this._state !== AppLifecycleState.STOPPED) {
      logger.warn('应用已在启动/运行中，跳过重复启动', { current_state: this._state });
      return;
    }

    const appStartTime = Date.now();
    const rootTraceContext = createTraceContext();
    const orchestrator = new LifecycleOrchestrator();
    this._state = AppLifecycleState.INITIALIZING;
    this._orchestrator = orchestrator;
    this._transportRuntime = null;

    try {
      const product = loadProductComposition();
      logger.info('应用开始启动', {
        trace_id: rootTraceContext.trace_id,
        product_id: product.id,
        product_name: product.display_name,
      });
      await EventBus.instance.publish(
        new AppStartingEvent({ appVersion: '1.0.0' }, rootTraceContext),
      );

      const foundationRuntime = new FoundationRuntime();
      await orchestrator.startPhase({
        name: 'foundation',
        modules: [foundationRuntime],
      }, rootTraceContext);
      const config = foundationRuntime.config;

      const transportRuntime = new KernelTransportRuntime(config);
      this._transportRuntime = transportRuntime;
      await orchestrator.startPhase({
        name: 'transport',
        modules: [transportRuntime],
      }, rootTraceContext);

      const applicationRuntime = new ApplicationRuntime({
        localDeviceActions: product.features.local_device_actions,
          skillAvailability: {
            productId: product.id,
            platform: currentExtensionPlatform(),
            features: new Set([
            ...(product.features.control_surface_gateway ? ['control_surface_gateway' as const] : []),
            ...(product.features.local_device_actions ? ['local_device_actions' as const] : []),
            ...(product.features.avatar ? ['avatar' as const] : []),
            ...(product.features.audio.tts ? ['audio.tts' as const] : []),
            ...(product.features.audio.asr ? ['audio.asr' as const] : []),
            ...(product.features.extensions ? ['extensions' as const] : []),
          ]),
        },
      });
      await orchestrator.startPhase({
        name: 'application',
        modules: [applicationRuntime],
      }, rootTraceContext);

      const presentationModules = [
        ...(product.features.avatar ? [new AvatarRuntime(config)] : []),
        ...(product.features.control_surface_gateway ? [new PresentationRuntime(
          config,
          applicationRuntime.perceptionAppService,
          applicationRuntime.skillCatalogAppService,
          async (reason) => {
            logger.info('收到产品控制表面全局停机请求', { reason });
            await this.stop(0);
          },
        )] : []),
      ];
      await orchestrator.startPhase({
        name: 'presentation',
        modules: presentationModules,
      }, rootTraceContext);

      await orchestrator.startPhase({
        name: 'core-readiness',
        mode: 'parallel',
        modules: [
          new CognitionRuntime(),
          ...(product.features.audio.tts || product.features.audio.asr
            ? [new AudioRuntime(product.features.audio)]
            : []),
        ],
      }, rootTraceContext);

      // 只有 Cognition 与必需传输属于入站就绪门；Audio 与 Extension 按能力独立降级。
      transportRuntime.openIngress();

      if (product.features.extensions) {
        await orchestrator.startPhase({
          name: 'extensions',
          modules: [new ExtensionRuntime(applicationRuntime.extensionHostAppService, product.id)],
        }, rootTraceContext);
      }

      await orchestrator.startPhase({
        name: 'organism',
        modules: [new OrganismRuntime()],
      }, rootTraceContext);

      this._startupTimeMs = Date.now() - appStartTime;
      this._state = AppLifecycleState.RUNNING;
      histogram('app.startup_ms', this._startupTimeMs);

      await EventBus.instance.publish(
        new AppStartedEvent({ startupTimeMs: this._startupTimeMs }, rootTraceContext),
      );

      logger.debug('应用启动计划已完成', {
        startup_plan: orchestrator.startupReport,
      });
      logger.info('应用启动完成，当前角色已就绪', {
        total_startup_time_ms: this._startupTimeMs,
        app_name: config.system.identity.app_name,
        app_version: config.system.identity.app_version,
        product_id: product.id,
      });
    } catch (error) {
      logger.critical('应用启动失败', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        trace_id: rootTraceContext.trace_id,
      });
      this._state = AppLifecycleState.ERROR;
      await this.stop(1);
      throw new CoreException(
        `应用启动失败: ${(error as Error).message}`,
        ErrorCode.LIFECYCLE_ERROR,
        rootTraceContext.trace_id,
      );
    }
  }

  public async stop(exitCode: number = 0): Promise<void> {
    if (this._state === AppLifecycleState.STOPPING || this._state === AppLifecycleState.STOPPED) {
      return;
    }

    const stopTraceContext = createTraceContext();
    logger.info('应用开始停止', {
      current_state: this._state,
      exit_code: exitCode,
      trace_id: stopTraceContext.trace_id,
    });

    this._state = AppLifecycleState.STOPPING;
    this._transportRuntime?.closeIngress();

    await EventBus.instance.publish(
      new AppStoppingEvent({ reason: exitCode === 0 ? '正常停机' : '异常停机' }, stopTraceContext),
    );

    try {
      if (this._orchestrator) {
        await this._orchestrator.stopStarted(stopTraceContext);
      }
      this._orchestrator = null;
      this._transportRuntime = null;

      this._state = AppLifecycleState.STOPPED;
      await EventBus.instance.publish(new AppStoppedEvent({ exitCode }, stopTraceContext));
      await EventBus.instance.shutdown();
      await closeLogger();

      console.log('应用已优雅停止');
      process.exit(exitCode);
    } catch (error) {
      console.error('应用停机过程中发生异常', error);
      process.exit(1);
    }
  }
}
