export interface IngressConfiguration {
  readonly rate_limit_per_source: number;
  readonly rate_limit_window_ms: number;
  readonly max_concurrent_requests: number;
  readonly circuit_breaker_threshold: number;
  readonly circuit_breaker_recovery_ms: number;
}

export interface AvatarHostConfiguration {
  readonly launch_mode: 'manual' | 'managed';
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly startup_timeout_ms: number;
  readonly restart_on_exit: boolean;
}

export interface AvatarConfiguration {
  readonly enabled: boolean;
  readonly heartbeat_interval_ms: number;
  readonly heartbeat_timeout_ms: number;
  readonly host: AvatarHostConfiguration;
  readonly emotion_mapping: Readonly<Record<string, {
    readonly expression_id?: string;
    readonly motion_group?: string;
    readonly animator_trigger?: string;
  }>>;
}

export interface AudioConfiguration {
  readonly tts: {
    readonly enabled: boolean;
    readonly route: {
      readonly primary: string;
      readonly fallbacks: string[];
      readonly circuit_breaker: { readonly failure_threshold: number; readonly recovery_timeout_ms: number };
    };
    readonly cache: { readonly enabled: boolean; readonly max_age_days: number };
    readonly providers: {
      readonly 'dashscope-cosyvoice': {
        readonly enabled: boolean;
        readonly endpoint: string;
        readonly model: string;
        readonly format: 'wav';
        readonly sample_rate: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
        readonly connect_timeout_ms: number;
        readonly receive_timeout_ms: number;
        readonly max_retries: number;
      };
    };
  };
  readonly asr: {
    readonly enabled: boolean;
    readonly provider: 'funasr';
    readonly resource_id: string;
  };
}

export interface VoiceConfiguration {
  readonly profile_id: string;
  readonly language: string;
  readonly style_instruction: string;
  readonly prosody: { readonly rate: number; readonly pitch: number; readonly volume: number };
  readonly bindings: { readonly 'dashscope-cosyvoice': { readonly voice_id: string } };
}

export interface LifeClockConfiguration {
  readonly ingress_debounce_ms: number;
  readonly ingress_focused_debounce_ms: number;
  readonly ingress_max_batch_messages: number;
  readonly ingress_max_batch_items: number;
  readonly focus_duration_ms: number;
  readonly focus_on_any_chat: boolean;
  readonly heartbeat_enabled: boolean;
  readonly heartbeat_interval_ms: number;
  readonly summon_keywords: string[];
}

export interface KernelConfiguration {
  readonly system: {
    readonly identity: { readonly app_name: string; readonly app_version: string };
    readonly character: { readonly active_id: string; readonly profile_root: string };
    readonly cognition_service: { readonly request_timeout_ms: number; readonly registration_timeout_ms: number };
    readonly ingress: IngressConfiguration;
    readonly avatar: AvatarConfiguration;
    readonly audio: AudioConfiguration;
    readonly surfaces: { readonly control_surface_gateway: { readonly enabled: boolean } };
    readonly extensions: { readonly extension_root_dir: string; readonly sandbox: { readonly timeout_ms: number } };
    readonly skill_plane: Readonly<Record<string, unknown>>;
    readonly memory: Readonly<Record<string, unknown>>;
    readonly embedding: Readonly<Record<string, unknown>>;
    readonly observability: { readonly level?: string; readonly [field: string]: unknown };
  };
  readonly character: {
    readonly inference: {
      readonly life_clock: LifeClockConfiguration;
      readonly action_stream: { readonly enabled: boolean; readonly channel: 'live2d' };
      readonly [field: string]: unknown;
    };
    readonly voice: VoiceConfiguration;
    readonly [field: string]: unknown;
  };
}

export interface KernelConfigurationPort {
  init(): Promise<void>;
  getConfig(): Readonly<KernelConfiguration>;
  freezeCoreConfig(): void;
  loadDashScopeSecretEnvironment(): Promise<Readonly<Record<string, string>>>;
}
