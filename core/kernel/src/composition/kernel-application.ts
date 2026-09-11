import { AppStartedEvent, AppStartingEvent, AppStoppedEvent, AppStoppingEvent } from '../domain/events';
import { CoreException } from '../domain/errors';
import { AppLifecycleState } from '../domain/lifecycle/lifecycle-state.enum';
import type { KernelConfiguration } from '../ports/configuration.port';
import type { KernelEventBusPort } from '../ports/event-bus.port';
import type { KernelLoggerPort, KernelObservabilityPort } from '../ports/observability.port';
import type { RuntimeProjectionInputPort } from '../ports/kernel-lifecycle.port';
import type { RuntimeModule } from '../runtime/modules/runtime-module';
import { LifecycleOrchestrator } from '../runtime/modules/lifecycle-orchestrator';
import { KernelBootstrapRuntime } from '../runtime/modules/kernel-bootstrap-runtime';
import { KernelTransportRuntime } from '../runtime/modules/kernel-transport-runtime';
import { CognitionRuntime } from '../runtime/modules/cognition-runtime';
import { AudioRuntime } from '../runtime/modules/audio-runtime';
import { ApplicationRuntime } from '../runtime/modules/application-runtime';
import { ExtensionRuntime } from '../runtime/modules/extension-runtime';
import { AvatarRuntime } from '../runtime/modules/avatar-runtime';
import { PresentationRuntime } from '../runtime/modules/presentation-runtime';
import { OrganismRuntime } from '../runtime/modules/organism-runtime';
import { DlqReplayRuntime } from '../runtime/modules/dlq-replay-runtime';
import { NodeKernelBootstrapAdapter } from '../adapters/bootstrap/kernel-bootstrap-adapter';
import { KernelConfigurationAdapter } from '../adapters/config/kernel-configuration-adapter';
import { KernelObservabilityAdapter } from '../adapters/observability/kernel-observability-adapter';
import { SkillInvocationDiagnosticsAdapter } from '../adapters/observability/skill-invocation-diagnostics-adapter';
import { EventBus } from '../adapters/events/event-bus';
import { RuntimeReadinessProjectionMapper } from '../application/projection/runtime-readiness-projection';
import { IngressGateManager } from '../application/ingress/ingress-gate-manager';
import { KernelCognitionTransport } from '../adapters/cognition/kernel-cognition-transport';
import { CognitionClient } from '../adapters/cognition/cognition-client';
import { CognitionManager } from '../adapters/cognition/cognition-process-adapter';
import { ManageCognitionLifecycle } from '../application/use-cases/manage-cognition-lifecycle';
import { AIProxy } from '../application/capabilities/inference/ai-proxy';
import { AudioService } from '../adapters/audio/audio-service';
import { AvatarController } from '../adapters/avatar/avatar-controller';
import { AvatarRuntimeAdapter } from '../adapters/avatar/avatar-runtime-adapter';
import { ControlSurfaceGateway } from '../adapters/surface/control-surface-gateway';
import { NodeStableIdentityAdapter } from '../adapters/identity/node-stable-identity-adapter';
import { ConversationDirectory } from '../application/capabilities/conversation/conversation-directory';
import { ChannelStateStore } from '../application/channel/channel-state-store';
import { AttentionLeaseStore } from '../application/attention/attention-lease-store';
import { AttentionSessionManager } from '../application/attention/attention-session-manager';
import { ActionStreamManager } from '../application/capabilities/action-stream/action-stream-manager';
import { VisualCommandDispatcher } from '../application/capabilities/action-stream/visual-command-dispatcher';
import { LifeClockManager } from '../application/organism/life-clock/life-clock-manager';
import { PerceptionAppService } from '../application/use-cases/perception-app.service';
import { SkillRegistry } from '../application/skill-plane/skill-registry';
import { SkillCatalogAppService } from '../application/use-cases/skill-catalog-app.service';
import { SkillPolicyEngine } from '../application/skill-plane/skill-policy-engine';
import { SkillPlanePolicy } from '../application/skill-plane/availability';
import { createChannelReplyPublisher, SkillActionController } from '../application/skill-plane/skill-action-controller';
import { LoggingSkillInvocationAuditSink, SkillInvocationGateway } from '../application/skill-plane/skill-invocation-gateway';
import { SkillPlanningAppService } from '../application/use-cases/skill-planning-app.service';
import { CoreSkillProvider } from '../application/skill-plane/providers/core';
import { UserSkillProvider } from '../application/skill-plane/providers/user';
import { McpServerSkillProvider } from '../adapters/skill-plane/mcp-server';
import { ControlSurfaceCorePlatformBridge } from '../adapters/surface/control-surface-core-platform-bridge';
import { currentExtensionPlatform } from '../adapters/platform/skill-availability';
import type { ProductFeatureId, SkillAvailabilityContext } from '../ports/skill-plane.port';
import { ExtensionRuntimeRegistry } from '../adapters/extension-host/extension-runtime-registry';
import { ExtensionHostAppService } from '../adapters/extension-host/extension-host-application-adapter';
import { ExtensionManager } from '../adapters/extension-host/extension-manager';
import { KernelExtensionRuntimeAdapter } from '../adapters/extension-host/kernel-extension-runtime-adapter';
import { ConfigApplicationService } from '../adapters/config/config-application-adapter';
import { ConfigManager } from '../adapters/config/config-manager';
import { ConversationHistoryService } from '../adapters/surface/conversation-history-service';
import { KernelPresentationAdapter } from '../adapters/surface/kernel-presentation-adapter';
import { KernelOrganismAdapter } from '../adapters/organism/kernel-organism-adapter';
import { DlqReplayIngress } from '../adapters/events/dlq-replay-ingress';
import { resolveLogDir } from '../adapters/filesystem/path-utils';
import { SystemClockAdapter } from '../adapters/time/system-clock-adapter';
import { loadProductComposition, type ProductComposition } from './product-composition';

interface OperationalRuntimePlan {
  readonly transport: KernelTransportRuntime;
  readonly application: ApplicationRuntime;
  readonly presentation: readonly RuntimeModule[];
  readonly coreReadiness: readonly RuntimeModule[];
  readonly extension?: ExtensionRuntime;
  readonly organism: OrganismRuntime;
  readonly recovery: DlqReplayRuntime;
}

type OperationalRuntimeFactory = (
  config: Readonly<KernelConfiguration>,
  requestStop: (exitCode?: number) => Promise<void>,
) => OperationalRuntimePlan;

/** Kernel 生命周期根；所有 concrete 都由下方唯一 composition factory 创建。 */
export class App {
  private stateValue = AppLifecycleState.UNINITIALIZED;
  private orchestrator: LifecycleOrchestrator | null = null;
  private transportRuntime: KernelTransportRuntime | null = null;

  public constructor(
    private readonly logger: KernelLoggerPort,
    private readonly observability: KernelObservabilityPort,
    private readonly eventBus: KernelEventBusPort,
    private readonly projection: RuntimeProjectionInputPort,
    private readonly bootstrap: KernelBootstrapRuntime,
    private readonly createOperationalPlan: OperationalRuntimeFactory,
  ) {}

  public get state(): AppLifecycleState { return this.stateValue; }

  public async start(): Promise<void> {
    if (this.stateValue !== AppLifecycleState.UNINITIALIZED && this.stateValue !== AppLifecycleState.STOPPED) return;
    const startedAt = Date.now();
    const context = this.observability.createTraceContext();
    const orchestrator = new LifecycleOrchestrator(this.logger, this.eventBus, this.projection);
    this.stateValue = AppLifecycleState.INITIALIZING;
    this.orchestrator = orchestrator;
    try {
      await this.eventBus.publish(new AppStartingEvent({ appVersion: '1.0.0' }, context));
      await orchestrator.startPhase({ name: 'foundation', modules: [this.bootstrap] }, context);
      const config = this.bootstrap.config;
      const plan = this.createOperationalPlan(config, (code = 0) => this.stop(code));
      this.transportRuntime = plan.transport;
      await orchestrator.startPhase({ name: 'transport', modules: [plan.transport] }, context);
      await orchestrator.startPhase({ name: 'application', modules: [plan.application] }, context);
      await orchestrator.startPhase({ name: 'presentation', modules: [...plan.presentation] }, context);
      await orchestrator.startPhase({ name: 'core-readiness', mode: 'parallel', modules: [...plan.coreReadiness] }, context);
      plan.transport.openIngress();
      if (plan.extension) await orchestrator.startPhase({ name: 'extensions', modules: [plan.extension] }, context);
      await orchestrator.startPhase({ name: 'organism', modules: [plan.organism] }, context);
      await orchestrator.startPhase({ name: 'recovery-ingress', modules: [plan.recovery] }, context);
      const startupTimeMs = Date.now() - startedAt;
      this.stateValue = AppLifecycleState.RUNNING;
      this.observability.histogram('app.startup_ms', startupTimeMs);
      await this.eventBus.publish(new AppStartedEvent({ startupTimeMs }, context));
      this.logger.info('应用启动完成，当前角色已就绪', { total_startup_time_ms: startupTimeMs });
    } catch (error) {
      this.stateValue = AppLifecycleState.ERROR;
      await this.stop(1);
      throw new CoreException(`应用启动失败: ${normalizeError(error)}`, 'LIFECYCLE_ERROR', context.trace_id);
    }
  }

  public async stop(exitCode = 0): Promise<void> {
    if (this.stateValue === AppLifecycleState.STOPPING || this.stateValue === AppLifecycleState.STOPPED) return;
    const context = this.observability.createTraceContext();
    this.stateValue = AppLifecycleState.STOPPING;
    this.transportRuntime?.closeIngress();
    await this.eventBus.publish(new AppStoppingEvent({ reason: exitCode === 0 ? '正常停机' : '异常停机' }, context));
    if (this.orchestrator) await this.orchestrator.stopStarted(context);
    this.orchestrator = null;
    this.transportRuntime = null;
    this.stateValue = AppLifecycleState.STOPPED;
    await this.eventBus.publish(new AppStoppedEvent({ exitCode }, context));
    await this.eventBus.shutdown();
    await this.observability.close();
  }
}

/** 无全局 install、无 service locator 的 production composition 入口。 */
export function createKernelApplication(product: ProductComposition = loadProductComposition()): App {
  const observability = new KernelObservabilityAdapter();
  const eventBus = EventBus.instance;
  const projection = new RuntimeReadinessProjectionMapper();
  const bootstrap = new KernelBootstrapRuntime(new NodeKernelBootstrapAdapter());
  const configuration = new KernelConfigurationAdapter();
  return new App(
    observability.logger('app-root'), observability, eventBus, projection, bootstrap,
    (config, requestStop) => createOperationalRuntimePlan({
      config, product, requestStop, observability, eventBus, projection, configuration,
    }),
  );
}

function createOperationalRuntimePlan(options: {
  readonly config: Readonly<KernelConfiguration>;
  readonly product: ProductComposition;
  readonly requestStop: (exitCode?: number) => Promise<void>;
  readonly observability: KernelObservabilityPort;
  readonly eventBus: EventBus;
  readonly projection: RuntimeReadinessProjectionMapper;
  readonly configuration: KernelConfigurationAdapter;
}): OperationalRuntimePlan {
  const { config, product, observability, eventBus, projection, configuration } = options;
  const clock = new SystemClockAdapter();
  const transportAdapter = new KernelCognitionTransport();
  const ingress = new IngressGateManager(observability.logger('ingress-gate'), clock);
  const transport = new KernelTransportRuntime(config, transportAdapter, ingress, projection);
  let cognitionRuntime: CognitionRuntime | null = null;
  const cognitionAdapter = new CognitionManager(
    transportAdapter, new CognitionClient(transportAdapter),
    (state, summary) => cognitionRuntime?.acceptLifecycleFact(state, summary),
  );
  cognitionRuntime = new CognitionRuntime(transport, new ManageCognitionLifecycle(cognitionAdapter), projection);
  const cognition = new AIProxy(cognitionAdapter);
  const audio = new AudioService();
  const avatar = new AvatarController(projection);
  const surface = new ControlSurfaceGateway(projection, avatar, audio);
  const conversations = new ConversationDirectory(new NodeStableIdentityAdapter());
  const channelState = new ChannelStateStore(observability.logger('channel-state'));
  const attentionLeases = new AttentionLeaseStore(clock);
  const actionStream = new ActionStreamManager(config.character.inference.action_stream, eventBus, observability);
  const attention = new AttentionSessionManager(
    config.character.inference.life_clock, observability, attentionLeases, clock,
  );
  const lifeClock = new LifeClockManager(
    config.character.inference.life_clock, eventBus, observability,
    observability.logger('life-clock-manager'), attentionLeases, clock,
  );
  const visual = new VisualCommandDispatcher(config.system.avatar, eventBus, observability.logger('visual-command-dispatcher'));
  const registry = new SkillRegistry();
  const catalog = new SkillCatalogAppService(registry);
  const bridge = new ControlSurfaceCorePlatformBridge(surface);
  const invocation = new SkillInvocationGateway(
    registry, new SkillPolicyEngine(),
    new LoggingSkillInvocationAuditSink(observability.logger('skill-invocation')),
    observability, new SkillInvocationDiagnosticsAdapter(),
    (request) => bridge.requestConfirmation(request),
  );
  const planning = new SkillPlanningAppService(
    catalog, invocation, (request, traceId) => cognition.requestAgentPlan(request, traceId),
  );
  const action = new SkillActionController(
    planning, (request, signal) => cognition.requestAgentSynthesis(request, signal),
    createChannelReplyPublisher(eventBus, observability), observability.logger('skill-action-controller'),
  );
  const perception = new PerceptionAppService(
    conversations, audio, channelState, attention, ingress, observability.logger('perception-gateway'),
  );
  const availability = createSkillAvailability(product);
  const skillPlanePolicy = new SkillPlanePolicy();
  const mcpProvider = new McpServerSkillProvider(
    projection, () => ConfigManager.instance.getConfig().system.skill_plane, product.id,
  );
  const providers = [
    new CoreSkillProvider(bridge, { localDeviceActions: product.features.local_device_actions }),
    new UserSkillProvider(), mcpProvider,
  ];
  const extensionHost = new ExtensionHostAppService(
    perception, catalog, availability, skillPlanePolicy, attentionLeases, lifeClock,
    new ExtensionRuntimeRegistry(availability, skillPlanePolicy),
    product.version,
  );
  const application = new ApplicationRuntime({
    setCognitionActionHandler: (handler) => transport.setCognitionActionHandler(handler),
    logger: observability.logger('application-runtime'), skillProviders: providers,
    providerReadiness: () => mcpProvider.getReadinessSnapshots(), extensionHostService: extensionHost,
    skillCatalog: catalog, skillPlanning: planning, skillAction: action, perception,
  });
  const configApplication = new ConfigApplicationService({ configManager: ConfigManager.instance, cognition: cognitionAdapter });
  const presentationAdapter = new KernelPresentationAdapter(
    config, actionStream, visual, surface, perception, catalog, configApplication,
    new ConversationHistoryService(conversations, cognitionAdapter),
    (reason) => { observability.logger('app-root').info('收到产品控制表面全局停机请求', { reason }); return options.requestStop(0); },
  );
  const extensionAdapter = new KernelExtensionRuntimeAdapter(
    new ExtensionManager(extensionHost, projection, product.id), surface,
  );
  const presentation: RuntimeModule[] = [
    ...(product.features.avatar ? [new AvatarRuntime(config, new AvatarRuntimeAdapter(avatar))] : []),
    ...(product.features.control_surface_gateway ? [new PresentationRuntime(presentationAdapter)] : []),
  ];
  const coreReadiness: RuntimeModule[] = [
    cognitionRuntime,
    ...(product.features.audio.tts || product.features.audio.asr ? [new AudioRuntime(
      product.features.audio, configuration, audio, surface, projection,
      observability.logger('audio-runtime'), resolveLogDir(),
    )] : []),
  ];
  return {
    transport, application, presentation, coreReadiness,
    extension: product.features.extensions ? new ExtensionRuntime(extensionAdapter, product.id) : undefined,
    organism: new OrganismRuntime(new KernelOrganismAdapter(attention, lifeClock, cognition, actionStream, eventBus)),
    recovery: new DlqReplayRuntime(new DlqReplayIngress()),
  };
}

function createSkillAvailability(product: ProductComposition): SkillAvailabilityContext {
  return {
    productId: product.id,
    platform: currentExtensionPlatform(),
    features: new Set<ProductFeatureId>([
      ...(product.features.control_surface_gateway ? ['control_surface_gateway' as const] : []),
      ...(product.features.local_device_actions ? ['local_device_actions' as const] : []),
      ...(product.features.avatar ? ['avatar' as const] : []),
      ...(product.features.audio.tts ? ['audio.tts' as const] : []),
      ...(product.features.audio.asr ? ['audio.asr' as const] : []),
      ...(product.features.extensions ? ['extensions' as const] : []),
    ]),
  };
}

function normalizeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
