import type {
  AudioConfiguration,
  AvatarConfiguration,
  VoiceConfiguration,
} from './configuration.port';
import type { RuntimeReadinessSnapshot } from './runtime-readiness.port';
import type {
  ASRRecognizeRequest,
  ASRRecognizeResponse,
  TTSSynthesizeRequest,
  TTSSynthesizeResponse,
} from './application-models';

export interface AudioProviderStatus {
  readonly provider_id: string;
  readonly role: 'primary' | 'fallback';
  readonly execution: 'cloud' | 'local';
  readonly status: 'ready' | 'degraded' | 'unavailable' | 'circuit_open' | 'unknown';
  readonly message?: string;
}

export interface AudioCapabilityStatus {
  readonly enabled: boolean;
  readonly disabled_reason?: string;
  readonly active_provider?: string;
  readonly route_state: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  readonly providers: AudioProviderStatus[];
}

export interface AudioStatusSnapshot {
  readonly updated_at: number;
  readonly tts: AudioCapabilityStatus;
  readonly asr: AudioCapabilityStatus;
}

export interface AudioRuntimePort {
  subscribeStatus(listener: (status: AudioStatusSnapshot, readiness: RuntimeReadinessSnapshot[]) => void): () => void;
  setProcessLogRoot(root: string): void;
  configure(
    config: AudioConfiguration,
    voice: VoiceConfiguration,
    secretEnvironment: Readonly<Record<string, string>>,
  ): void;
  prepareRequiredAudioResources(): Promise<unknown>;
  getReadinessSnapshots(): RuntimeReadinessSnapshot[];
  stop(): Promise<void>;
}

export interface AudioApplicationPort {
  synthesizeSpeech(request: TTSSynthesizeRequest): Promise<TTSSynthesizeResponse>;
  recognizeSpeech(request: ASRRecognizeRequest): Promise<ASRRecognizeResponse>;
  getStatus(): Promise<AudioStatusSnapshot>;
}

export interface AvatarRuntimePort {
  start(config: AvatarConfiguration): Promise<void>;
  stop(): Promise<void>;
  getReadinessSnapshot(): RuntimeReadinessSnapshot[];
}

export interface ControlSurfaceRuntimePort {
  broadcastAudioStatus(status: AudioStatusSnapshot): void;
}

export interface DlqReplayRuntimePort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface PresentationLifecyclePort {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly controlSurfaceEnabled: boolean;
}

export interface OrganismLifecyclePort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ExtensionLifecycleControllerPort {
  init(): Promise<void>;
  startAllExtensions(): Promise<void>;
  shutdown(): Promise<void>;
  getReadinessSnapshots(): RuntimeReadinessSnapshot[];
}

export interface ExtensionRuntimePort {
  createController(productId: 'desktop' | 'personal-server'): ExtensionLifecycleControllerPort;
  attachController(controller: ExtensionLifecycleControllerPort | null): void;
}
