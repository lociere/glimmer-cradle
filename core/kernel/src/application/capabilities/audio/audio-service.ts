import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type {
  ASRRecognizeRequest,
  ASRRecognizeResponse,
  AudioConfig,
  AudioStatusPayload,
  TTSSynthesizeRequest,
  TTSSynthesizeResponse,
  VoiceConfig,
} from '@glimmer-cradle/protocol';
import { getLogger } from '../../../foundation/logger/logger';
import type { RuntimeReadinessSnapshot } from '../../../foundation/runtime-readiness';
import {
  strongestRuntimeResourceState,
  type RuntimeReconcilerSnapshot,
  type RuntimeResourceSnapshot,
} from '../../../foundation/runtime-reconciler';
import {
  resolveCachePath,
  resolveConfiguredProjectPath,
} from '../../../foundation/utils/path-utils';
import {
  configureOfficialAudioEngine,
  probeOfficialAudioEngine,
  recognizeOfficialAudioASR,
  setOfficialAudioProcessLogRoot,
  stopOfficialAudioEngines,
  synthesizeOfficialAudioTTS,
  warmupOfficialAudioASR,
  warmupOfficialAudioTTS,
} from './official-audio-engine';

const logger = getLogger('audio-service');
type AudioLane = 'tts' | 'asr';
type AudioReadiness = {
  status: 'disabled' | 'unknown' | 'ready' | 'degraded' | 'unavailable';
  message?: string;
};
type ProviderProjection = AudioStatusPayload['tts']['providers'][number];
type AudioStatusListener = (
  status: AudioStatusPayload,
  readiness: RuntimeReadinessSnapshot[],
) => void;

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  tts: {
    enabled: false,
    route: {
      primary: 'dashscope-cosyvoice',
      fallbacks: [],
      circuit_breaker: { failure_threshold: 3, recovery_timeout_ms: 30000 },
    },
    cache: { enabled: true, max_age_days: 30 },
    providers: {
      'dashscope-cosyvoice': {
        enabled: true,
        endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
        model: 'cosyvoice-v3.5-flash',
        format: 'wav',
        sample_rate: 24000,
        connect_timeout_ms: 5000,
        receive_timeout_ms: 20000,
        max_retries: 1,
      },
    },
  },
  asr: { enabled: false, provider: 'funasr', resource_id: 'funasr.sensevoice-small' },
};

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  profile_id: 'unbound',
  language: 'zh-CN',
  style_instruction: '',
  prosody: { rate: 1, pitch: 1, volume: 50 },
  bindings: {
    'dashscope-cosyvoice': { voice_id: '' },
  },
};

/** Kernel 的 Audio 能力门；provider 路由与执行完全由 Audio Engine 拥有。 */
export class AudioService {
  private static _instance: AudioService | null = null;

  static get instance(): AudioService {
    AudioService._instance ??= new AudioService();
    return AudioService._instance;
  }

  private audioConfig: AudioConfig = DEFAULT_AUDIO_CONFIG;
  private voiceConfig: VoiceConfig = DEFAULT_VOICE_CONFIG;
  private allowStatusProbe = false;
  private ttsReadiness: AudioReadiness = { status: 'unknown', message: 'TTS 等待能力层预热' };
  private asrReadiness: AudioReadiness = { status: 'unknown', message: 'ASR 等待能力层预热' };
  private cachedStatus: AudioStatusPayload = this.buildInitialStatus();
  private readonly statusListeners = new Set<AudioStatusListener>();

  private constructor() {}

  configure(
    audioConfig: AudioConfig,
    voiceConfig: VoiceConfig,
    secretEnvironment: Record<string, string> = {},
  ): void {
    this.audioConfig = audioConfig;
    this.voiceConfig = voiceConfig;
    this.cachedStatus = this.buildInitialStatus();
    configureOfficialAudioEngine(audioConfig, voiceConfig, secretEnvironment);
    this.notifyStatusChanged();
  }

  subscribeStatus(listener: AudioStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  isLaneEnabled(lane: AudioLane): boolean {
    return this.audioConfig[lane].enabled;
  }

  setProcessLogRoot(logDir: string): void {
    setOfficialAudioProcessLogRoot(logDir);
  }

  async prepareRequiredAudioResources(): Promise<Record<string, unknown>> {
    this.allowStatusProbe = false;
    this.ttsReadiness = this.isLaneEnabled('tts')
      ? { status: 'unknown', message: 'TTS 路由正在预热' }
      : { status: 'disabled', message: 'TTS 增强未启用' };
    this.asrReadiness = this.isLaneEnabled('asr')
      ? { status: 'unknown', message: 'FunASR 正在预热' }
      : { status: 'disabled', message: 'ASR 增强未启用' };
    this.notifyStatusChanged();

    await Promise.all([
      this.isLaneEnabled('tts')
        ? this.prepareLane('tts', warmupOfficialAudioTTS())
        : Promise.resolve(),
      this.isLaneEnabled('asr')
        ? this.prepareLane('asr', warmupOfficialAudioASR())
        : Promise.resolve(),
    ]);
    this.allowStatusProbe = true;
    try {
      await this.getStatus();
    } catch (error) {
      logger.warn('Audio 预热后状态探测失败', { error: error instanceof Error ? error.message : String(error) });
    }
    return {
      tts: this.ttsReadiness.status,
      asr: this.asrReadiness.status,
      runtime_readiness: this.getReadinessSnapshots(),
    };
  }

  async synthesizeSpeech(request: TTSSynthesizeRequest): Promise<TTSSynthesizeResponse> {
    if (!this.isLaneEnabled('tts')) return { status: 'error', message: 'TTS 已在系统配置中关闭' };
    const text = request.text.trim();
    if (!text) return { status: 'error', message: 'text is required' };

    const cachedPath = request.output_path ? null : await this.resolveCachedTTSPath(text);
    if (cachedPath) {
      logger.info('TTS 命中缓存', { output_path: cachedPath, text_length: text.length });
      return { status: 'success', output_path: cachedPath };
    }

    const outputPath = await this.resolveOutputPath(request.output_path, text);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    try {
      const response = await synthesizeOfficialAudioTTS(text, outputPath);
      if (response.status !== 'success') {
        const message = response.error?.message ?? 'TTS route unavailable';
        this.ttsReadiness = { status: 'unavailable', message };
        this.markLaneUnavailable('tts', message);
        return { status: 'error', message };
      }
      let resultPath = readString(response.payload?.output_path);
      const providerId = readString(response.payload?.provider_id);
      const fallbackUsed = response.payload?.fallback_used === true;
      const durationMs = readNumber(response.payload?.duration_ms);
      if (!resultPath || !providerId) {
        return { status: 'error', message: 'Audio Engine 返回的 TTS 结果不完整' };
      }
      if (fallbackUsed && !request.output_path && this.audioConfig.tts.cache.enabled) {
        const fallbackPath = path.join(
          path.dirname(resultPath),
          `tts-fallback-${Date.now()}-${this.hashText(text)}.wav`,
        );
        await fs.rename(resultPath, fallbackPath);
        resultPath = fallbackPath;
      }
      this.ttsReadiness = { status: fallbackUsed ? 'degraded' : 'ready' };
      this.updateActiveProvider('tts', providerId, fallbackUsed ? 'degraded' : 'ready');
      logger.info('TTS 合成完成', {
        output_path: resultPath,
        text_length: text.length,
        provider_id: providerId,
        fallback_used: fallbackUsed,
        duration_ms: durationMs,
        trace_id: request.trace_id,
      });
      return {
        status: 'success',
        output_path: resultPath,
        provider_id: providerId,
        fallback_used: fallbackUsed,
        ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ttsReadiness = { status: 'unavailable', message };
      this.markLaneUnavailable('tts', message);
      logger.warn('TTS 路由请求失败', { error: message });
      return { status: 'error', message };
    }
  }

  async recognizeSpeech(request: ASRRecognizeRequest): Promise<ASRRecognizeResponse> {
    if (!this.isLaneEnabled('asr')) return { status: 'error', message: 'ASR 已在系统配置中关闭' };
    const inputPath = request.audio_path.trim();
    if (!inputPath) return { status: 'error', message: 'audio_path is required' };
    if (/^https?:\/\//i.test(inputPath)) return { status: 'error', message: 'ASR 暂不接受远程音频 URL' };
    const resolvedPath = path.isAbsolute(inputPath) ? inputPath : resolveConfiguredProjectPath(inputPath);
    try {
      await fs.access(resolvedPath);
    } catch {
      return { status: 'error', message: `audio file not found: ${resolvedPath}` };
    }

    try {
      const response = await recognizeOfficialAudioASR(resolvedPath);
      if (response.status !== 'success') {
        const message = response.error?.message ?? 'FunASR unavailable';
        this.asrReadiness = { status: 'unavailable', message };
        this.markLaneUnavailable('asr', message);
        return { status: 'error', message };
      }
      const text = readString(response.payload?.text);
      const providerId = readString(response.payload?.provider_id) ?? 'funasr';
      const durationMs = readNumber(response.payload?.duration_ms);
      if (!text) return { status: 'error', message: 'Audio Engine 未返回识别文本' };
      this.asrReadiness = { status: 'ready' };
      this.updateActiveProvider('asr', providerId, 'ready');
      logger.info('ASR 识别完成', {
        audio_path: resolvedPath,
        text_length: text.length,
        provider_id: providerId,
        duration_ms: durationMs,
        trace_id: request.trace_id,
      });
      return {
        status: 'success',
        text,
        provider_id: providerId,
        ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.asrReadiness = { status: 'unavailable', message };
      this.markLaneUnavailable('asr', message);
      return { status: 'error', message };
    }
  }

  async getStatus(): Promise<AudioStatusPayload> {
    if (!this.allowStatusProbe) return this.cachedStatus;
    const response = await probeOfficialAudioEngine({
      tts: this.isLaneEnabled('tts'),
      asr: this.isLaneEnabled('asr'),
    });
    const lanes = response.payload?.providers as Record<string, unknown> | undefined;
    this.cachedStatus = {
      updated_at: Date.now(),
      tts: this.isLaneEnabled('tts')
        ? this.normalizeLaneStatus(lanes?.tts)
        : this.disabledLane('TTS 已关闭'),
      asr: this.isLaneEnabled('asr')
        ? this.normalizeLaneStatus(lanes?.asr)
        : this.disabledLane('ASR 已关闭'),
    };
    this.ttsReadiness = this.readReadinessFromStatus(this.cachedStatus.tts);
    this.asrReadiness = this.readReadinessFromStatus(this.cachedStatus.asr);
    this.notifyStatusChanged();
    return this.cachedStatus;
  }

  getCachedStatus(): AudioStatusPayload {
    return { ...this.cachedStatus, updated_at: Date.now() };
  }

  getReadinessSnapshots(): RuntimeReadinessSnapshot[] {
    const lanes = [
      this.toReadinessSnapshot('tts', this.ttsReadiness),
      this.toReadinessSnapshot('asr', this.asrReadiness),
    ];
    return [this.buildAggregateReadinessSnapshot(lanes), ...lanes];
  }

  async stop(): Promise<void> {
    await stopOfficialAudioEngines();
    logger.info('官方音频引擎已停止');
  }

  private buildInitialStatus(): AudioStatusPayload {
    const route = this.audioConfig.tts.route;
    return {
      updated_at: Date.now(),
      tts: this.audioConfig.tts.enabled ? {
        enabled: true,
        route_state: 'unknown',
        providers: [route.primary, ...route.fallbacks].map((providerId, index) => ({
          provider_id: providerId,
          role: index === 0 ? 'primary' : 'fallback',
          execution: providerId === 'dashscope-cosyvoice' ? 'cloud' : 'local',
          status: 'unknown',
          message: '等待 Audio Engine 预热',
        })),
      } : this.disabledLane('TTS 已关闭'),
      asr: this.audioConfig.asr.enabled ? {
        enabled: true,
        route_state: 'unknown',
        providers: [{
          provider_id: 'funasr', role: 'primary', execution: 'local', status: 'unknown',
          message: '等待 Audio Engine 预热',
        }],
      } : this.disabledLane('ASR 已关闭'),
    };
  }

  private disabledLane(reason: string): AudioStatusPayload['tts'] {
    return { enabled: false, disabled_reason: reason, route_state: 'disabled', providers: [] };
  }

  private normalizeLaneStatus(value: unknown): AudioStatusPayload['tts'] {
    const lane = isRecord(value) ? value : {};
    const routeState = lane.route_state;
    const normalizedRouteState = isRouteState(routeState) ? routeState : 'unavailable';
    const providers = Array.isArray(lane.providers)
      ? lane.providers.filter(isRecord).map((provider): ProviderProjection => ({
        provider_id: readString(provider.provider_id) ?? 'unknown',
        role: provider.role === 'fallback' ? 'fallback' : 'primary',
        execution: provider.execution === 'cloud' ? 'cloud' : 'local',
        status: isProviderState(provider.status) ? provider.status : 'unknown',
        ...(readString(provider.message) ? { message: readString(provider.message) } : {}),
      }))
      : [];
    return {
      enabled: true,
      route_state: normalizedRouteState,
      ...(readString(lane.active_provider) ? { active_provider: readString(lane.active_provider) } : {}),
      providers,
      ...(readString(lane.message) ? { disabled_reason: readString(lane.message) } : {}),
    };
  }

  private readReadinessFromStatus(status: AudioStatusPayload['tts']): AudioReadiness {
    if (status.route_state === 'disabled') return { status: 'disabled', message: status.disabled_reason };
    if (status.route_state === 'ready') return { status: 'ready' };
    if (status.route_state === 'degraded') return { status: 'degraded', message: '当前由 fallback provider 承载' };
    if (status.route_state === 'unknown') return { status: 'unknown', message: '等待 Audio Engine 探测' };
    return {
      status: 'unavailable',
      message: status.disabled_reason ?? status.providers.find((provider) => provider.message)?.message,
    };
  }

  private updateActiveProvider(lane: AudioLane, providerId: string, routeState: 'ready' | 'degraded'): void {
    const current = this.cachedStatus[lane];
    this.cachedStatus = {
      ...this.cachedStatus,
      updated_at: Date.now(),
      [lane]: {
        ...current,
        active_provider: providerId,
        route_state: routeState,
        providers: current.providers.map((provider) => provider.provider_id === providerId
          ? { ...provider, status: 'ready' as const, message: undefined }
          : provider),
      },
    };
    this.notifyStatusChanged();
  }

  private async prepareLane(
    lane: AudioLane,
    warmup: Promise<Awaited<ReturnType<typeof warmupOfficialAudioTTS>>>,
  ): Promise<void> {
    const result = await toSettled(warmup);
    const readiness = this.readWarmupResult(lane, result);
    if (lane === 'tts') this.ttsReadiness = readiness;
    else this.asrReadiness = readiness;

    if (result.status === 'fulfilled' && result.value.status === 'success') {
      if (lane === 'tts') {
        this.cachedStatus = {
          ...this.cachedStatus,
          updated_at: Date.now(),
          tts: this.normalizeLaneStatus(result.value.payload),
        };
      } else {
        this.updateActiveProvider('asr', readString(result.value.payload?.provider_id) ?? 'funasr', 'ready');
        return;
      }
    } else {
      this.markLaneUnavailable(lane, readiness.message ?? `${lane} warmup failed`);
      return;
    }
    this.notifyStatusChanged();
  }

  private markLaneUnavailable(lane: AudioLane, message: string): void {
    const current = this.cachedStatus[lane];
    this.cachedStatus = {
      ...this.cachedStatus,
      updated_at: Date.now(),
      [lane]: {
        ...current,
        route_state: 'unavailable',
        active_provider: undefined,
        providers: current.providers.map((provider) => ({
          ...provider,
          status: 'unavailable' as const,
          message,
        })),
      },
    };
    this.notifyStatusChanged();
  }

  private notifyStatusChanged(): void {
    const status = this.getCachedStatus();
    const readiness = this.getReadinessSnapshots();
    for (const listener of this.statusListeners) {
      try {
        listener(status, readiness);
      } catch (error) {
        logger.warn('Audio 状态订阅者处理失败', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private readWarmupResult(
    lane: AudioLane,
    result: PromiseSettledResult<Awaited<ReturnType<typeof warmupOfficialAudioTTS>>>,
  ): AudioReadiness {
    if (result.status === 'rejected') {
      return { status: 'unavailable', message: result.reason instanceof Error ? result.reason.message : String(result.reason) };
    }
    if (result.value.status !== 'success') {
      return { status: 'unavailable', message: result.value.error?.message ?? `${lane} warmup failed` };
    }
    if (lane === 'tts' && result.value.payload?.route_state === 'degraded') {
      return { status: 'degraded', message: 'TTS 主路由不可用，已启用 fallback provider' };
    }
    return { status: 'ready' };
  }

  private async resolveOutputPath(rawPath?: string, text?: string): Promise<string> {
    if (rawPath?.trim()) return path.isAbsolute(rawPath) ? rawPath : resolveConfiguredProjectPath(rawPath);
    const dir = resolveCachePath(path.join('audio', 'tts'));
    const suffix = text ? this.hashText(text) : String(Date.now());
    const prefix = this.audioConfig.tts.cache.enabled ? 'tts' : `tts-${Date.now()}`;
    return path.join(dir, `${prefix}-${suffix}.wav`);
  }

  private async resolveCachedTTSPath(text: string): Promise<string | null> {
    if (!this.audioConfig.tts.cache.enabled) return null;
    const outputPath = await this.resolveOutputPath(undefined, text);
    try {
      const stat = await fs.stat(outputPath);
      const maxAgeMs = this.audioConfig.tts.cache.max_age_days * 24 * 60 * 60 * 1000;
      if (Date.now() - stat.mtimeMs <= maxAgeMs && await this.isFinalizedWav(outputPath, stat.size)) {
        return outputPath;
      }
      logger.warn('TTS 缓存产物已过期或 WAV 容器未定稿，将重新生成', { output_path: outputPath });
      await fs.unlink(outputPath);
    } catch {
      return null;
    }
    return null;
  }

  private async isFinalizedWav(outputPath: string, fileSize: number): Promise<boolean> {
    if (fileSize < 12 || fileSize - 8 > 0xFFFFFFFF) return false;
    const handle = await fs.open(outputPath, 'r');
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return bytesRead === header.length
        && header.toString('ascii', 0, 4) === 'RIFF'
        && header.toString('ascii', 8, 12) === 'WAVE'
        && header.readUInt32LE(4) === fileSize - 8;
    } finally {
      await handle.close();
    }
  }

  private hashText(text: string): string {
    return createHash('sha256')
      .update(JSON.stringify({ route: this.audioConfig.tts.route, providers: this.audioConfig.tts.providers, voice: this.voiceConfig }))
      .update('\0')
      .update(text)
      .digest('hex')
      .slice(0, 24);
  }

  private toReadinessSnapshot(lane: AudioLane, readiness: AudioReadiness): RuntimeReadinessSnapshot {
    const enabled = this.isLaneEnabled(lane);
    const label = lane === 'tts' ? 'TTS' : 'ASR';
    const state = !enabled ? 'stopped'
      : readiness.status === 'ready' ? 'ready'
        : readiness.status === 'unknown' ? 'starting' : 'degraded';
    const reconciler = this.buildLaneReconcilerSnapshot(lane, readiness);
    return {
      runtime_id: `audio.${lane}`,
      owner: 'engine',
      phase: 'model_warmup',
      state,
      blocking: false,
      summary: !enabled ? `${label} 已关闭`
        : readiness.status === 'ready' ? `${label} 路由已就绪`
          : `${label} ${readiness.message ?? '尚未就绪'}`,
      details_ref: `data/observability/logs/application/audio-${lane}.console.log`,
      reconciler,
    };
  }

  private buildLaneReconcilerSnapshot(lane: AudioLane, readiness: AudioReadiness): RuntimeReconcilerSnapshot {
    if (!this.isLaneEnabled(lane)) {
      return { desired: `${lane}.disabled`, actual: `${lane}.disabled`, readiness: 'ready', resources: [] };
    }
    const providers = this.cachedStatus[lane].providers;
    const resources: RuntimeResourceSnapshot[] = providers.map((provider) => {
      const providerReadiness = provider.status === 'ready' ? 'ready'
        : provider.status === 'unknown' ? 'pending' : 'degraded';
      return {
        resource_id: `audio.${lane}.${provider.provider_id}`,
        resource_kind: provider.execution === 'cloud' ? 'cloud_provider' : 'local_provider',
        desired_state: 'ready',
        actual_state: providerReadiness,
        readiness: providerReadiness,
        summary: provider.message ?? `${provider.provider_id} ${provider.status}`,
      };
    });
    const routeReadiness = readiness.status === 'ready' ? 'ready'
      : readiness.status === 'unknown' ? 'pending' : 'degraded';
    return {
      desired: `${lane}.ready`,
      actual: `${lane}.${readiness.status}`,
      readiness: routeReadiness,
      resources,
    };
  }

  private buildAggregateReadinessSnapshot(lanes: RuntimeReadinessSnapshot[]): RuntimeReadinessSnapshot {
    const allDisabled = lanes.every((snapshot) => snapshot.state === 'stopped');
    const resources: RuntimeResourceSnapshot[] = lanes.map((snapshot) => ({
      resource_id: snapshot.runtime_id,
      resource_kind: 'audio_lane',
      desired_state: 'ready',
      actual_state: snapshot.reconciler?.readiness ?? 'unknown',
      readiness: snapshot.reconciler?.readiness ?? 'unknown',
      summary: snapshot.summary,
    }));
    const readiness = strongestRuntimeResourceState(resources);
    return {
      runtime_id: 'audio.host',
      owner: 'engine',
      phase: 'capability_plane',
      state: readiness === 'ready' ? 'ready' : readiness === 'pending' || readiness === 'unknown' ? 'starting' : 'degraded',
      blocking: false,
      summary: allDisabled ? '语音增强未启用，基础运行形态保持就绪'
        : readiness === 'ready' ? '已启用的语音能力整体就绪' : '已启用的语音能力存在待处理路线',
      reconciler: {
        desired: 'audio-ready',
        actual: resources.map((resource) => `${resource.resource_id}=${resource.readiness}`).join(','),
        readiness,
        resources,
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRouteState(value: unknown): value is AudioStatusPayload['tts']['route_state'] {
  return ['disabled', 'ready', 'degraded', 'unavailable', 'unknown'].includes(String(value));
}

function isProviderState(value: unknown): value is ProviderProjection['status'] {
  return ['ready', 'degraded', 'unavailable', 'circuit_open', 'unknown'].includes(String(value));
}

async function toSettled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}
