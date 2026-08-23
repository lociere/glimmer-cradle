import { getLogger } from '../../ports/kernel-side-effects.port';
import { AudioService } from '../../application/capabilities/audio/audio-service';
import { ControlSurfaceGateway } from '../../application/capabilities/control-surface/control-surface-gateway';
import { ConfigManager } from '../../ports/kernel-side-effects.port';
import { resolveLogDir } from '../../ports/kernel-side-effects.port';
import type { RuntimeModule } from './runtime-module';
import type { AudioConfig, ProductComposition, TraceContext } from '@glimmer-cradle/protocol';
import { RuntimeReadinessProjectionMapper } from '../../application/projection/runtime-readiness-projection';

const logger = getLogger('audio-runtime');
type ProductAudioComposition = ProductComposition['features']['audio'];

export class AudioRuntime implements RuntimeModule {
  public readonly name = 'audio-runtime';
  private disposeStatusSubscription: (() => void) | null = null;

  public constructor(private readonly composition: ProductAudioComposition) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const config = ConfigManager.instance.getConfig();
    const logDir = resolveLogDir();
    const audioSecrets = await ConfigManager.instance.loadDashScopeSecretEnvironment();
    this.disposeStatusSubscription?.();
    this.disposeStatusSubscription = AudioService.instance.subscribeStatus((status, readiness) => {
      RuntimeReadinessProjectionMapper.instance.replaceModuleSnapshots(this.name, readiness);
      ControlSurfaceGateway.instance.broadcastAudioStatus(status);
    });
    AudioService.instance.setProcessLogRoot(logDir);
    AudioService.instance.configure(
      applyProductAudioComposition(config.system.audio, this.composition),
      config.character.voice,
      audioSecrets,
    );
    void AudioService.instance.prepareRequiredAudioResources()
      .catch((error) => logger.warn('已启用的 Audio 增强后台预热失败', {
        error: error instanceof Error ? error.message : String(error),
      }));

    return {
      audio: 'background-warmup',
      runtime_readiness: AudioService.instance.getReadinessSnapshots(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await AudioService.instance.stop();
    this.disposeStatusSubscription?.();
    this.disposeStatusSubscription = null;
    logger.debug('Audio Runtime 已停止');
  }
}

function applyProductAudioComposition(
  config: AudioConfig,
  composition: ProductAudioComposition,
): AudioConfig {
  return {
    ...config,
    tts: { ...config.tts, enabled: config.tts.enabled && composition.tts },
    asr: { ...config.asr, enabled: config.asr.enabled && composition.asr },
  };
}
