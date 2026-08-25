export interface AudioProviderStatus {
  provider_id: string;
  role: 'primary' | 'fallback';
  execution: 'cloud' | 'local';
  status: 'ready' | 'degraded' | 'unavailable' | 'circuit_open' | 'unknown';
  message?: string;
}

export interface AudioCapabilityStatus {
  enabled: boolean;
  disabled_reason?: string;
  active_provider?: string;
  route_state: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  providers: AudioProviderStatus[];
}

export interface AudioStatusPayload {
  updated_at: number;
  tts: AudioCapabilityStatus;
  asr: AudioCapabilityStatus;
}
