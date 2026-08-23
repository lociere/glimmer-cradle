import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { AudioConfiguration, KernelConfigurationPort } from '../../ports/configuration.port';
import type { AudioRuntimePort, ControlSurfaceRuntimePort } from '../../ports/runtime-capabilities.port';
import type { KernelLoggerPort } from '../../ports/observability.port';
import type { RuntimeProjectionInputPort } from '../../ports/kernel-lifecycle.port';

export interface ProductAudioComposition { readonly tts: boolean; readonly asr: boolean }

export class AudioRuntime implements RuntimeModule {
  public readonly name = 'audio-runtime';
  private disposeStatusSubscription: (() => void) | null = null;

  public constructor(
    private readonly composition: ProductAudioComposition,
    private readonly configuration: KernelConfigurationPort,
    private readonly audio: AudioRuntimePort,
    private readonly surface: ControlSurfaceRuntimePort,
    private readonly projection: RuntimeProjectionInputPort,
    private readonly logger: KernelLoggerPort,
    private readonly processLogRoot: string,
  ) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const config = this.configuration.getConfig();
    const audioSecrets = await this.configuration.loadDashScopeSecretEnvironment();
    this.disposeStatusSubscription?.();
    this.disposeStatusSubscription = this.audio.subscribeStatus((status, readiness) => {
      this.projection.replaceModuleSnapshots(this.name, readiness);
      this.surface.broadcastAudioStatus(status);
    });
    this.audio.setProcessLogRoot(this.processLogRoot);
    this.audio.configure(
      applyProductAudioComposition(config.system.audio, this.composition),
      config.character.voice,
      audioSecrets,
    );
    void this.audio.prepareRequiredAudioResources()
      .catch((error) => this.logger.warn('已启用的 Audio 增强后台预热失败', {
        error: error instanceof Error ? error.message : String(error),
      }));

    return {
      audio: 'background-warmup',
      runtime_readiness: this.audio.getReadinessSnapshots(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await this.audio.stop();
    this.disposeStatusSubscription?.();
    this.disposeStatusSubscription = null;
    this.logger.debug('Audio Runtime 已停止');
  }
}

function applyProductAudioComposition(
  config: AudioConfiguration,
  composition: ProductAudioComposition,
): AudioConfiguration {
  return {
    ...config,
    tts: { ...config.tts, enabled: config.tts.enabled && composition.tts },
    asr: { ...config.asr, enabled: config.asr.enabled && composition.asr },
  };
}
