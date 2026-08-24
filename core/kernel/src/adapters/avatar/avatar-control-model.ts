export interface AvatarPresentationPayload {
  placement_id?: string;
  display_scale?: number;
  reset_placement?: boolean;
}

export interface AvatarHostHelloPayload {
  host_kind?: string;
  host_id?: string;
  host_version?: string;
  capabilities?: string[];
  model_id?: string;
  avatar_package_id?: string;
}

export interface AvatarHostReadyPayload {
  host_id?: string;
  model_id?: string;
  avatar_package_id?: string;
  worker_window_state: 'isolated' | 'visible' | 'unknown';
  composition_surface_state: 'attached' | 'failed' | 'unknown';
  first_frame_presented: boolean;
  interaction_ready: boolean;
  summary: string;
}

export interface CharacterPresentationProjectionPayload {
  avatar_package_id: string;
  model_id: string;
  display_name: string;
  kind: 'live2d';
  backend: 'unity';
  host_kind: 'unity' | 'offline';
  avatar_state: 'starting' | 'ready' | 'degraded' | 'stopped' | 'pending';
  appearance: { placement_id?: string; display_scale: number };
  lifecycle: AvatarHostReadyPayload & {
    worker_window_state: 'isolated' | 'visible' | 'unknown';
    composition_surface_state: 'attached' | 'failed' | 'unknown';
    ready: boolean;
  };
}

export interface PresentationDownstreamFrame {
  kind: string;
  trace_id?: string;
  timestamp?: number;
  emotion?: { emotion_type?: string; intensity?: number; trigger?: string; blend_time_ms?: number };
  thought?: { active?: boolean; hint?: string };
  audio_play?: { audio_id?: string; audio_uri?: string; audio_data?: string; mime_type?: string; duration_ms?: number };
  expression?: { expression_id?: string; blend_time_ms?: number; auto_reset?: boolean };
  motion?: { motion_id?: string; loop?: boolean; priority?: number };
  lip_sync?: { amplitude?: number; source?: string };
  parameter?: { param_id?: string; value?: number; fade_ms?: number };
  avatar_intent?: { action_id?: string; operation?: string; source?: string; priority?: number };
  presentation?: AvatarPresentationPayload;
  character_presentation_projection?: CharacterPresentationProjectionPayload;
  load_scene?: { scene_id?: string; fade_ms?: number };
  unload_scene?: { fade_ms?: number };
}

export interface PresentationUpstreamFrame {
  kind: string;
  trace_id?: string;
  timestamp?: number;
  host_hello?: AvatarHostHelloPayload;
  host_ready?: AvatarHostReadyPayload;
  avatar_action_state?: { action_id?: string; state?: string; active_action_ids?: string[]; message?: string };
  animation_complete?: { animation_id?: string };
  error?: { code?: string; message?: string };
}
