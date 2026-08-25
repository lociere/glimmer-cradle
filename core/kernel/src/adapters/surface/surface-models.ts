import type { ChannelReplyMessage, ConversationNotice } from '@glimmer-cradle/extension-sdk';
import type { AudioStatusPayload } from '../audio/audio-status-projection';
import type { ConfigurationSnapshotRequest, ConfigurationSnapshotResult, ConfigurationTestRequest, ConfigurationTestResult, ConfigurationUpdateRequest, ConfigurationUpdateResult } from '../config/configuration-models';
import type { ExtensionInstallationProjection, ExtensionRuntimeProjection } from '../extension-host/extension-runtime-projection';
import type { ConversationHistoryRequest, ConversationHistoryResult } from './conversation-history-models';
import type { ExtensionInstallSource } from '../extension-installation/extension-package-manager';

export interface ExtensionInstallPrepareRequest { request_id: string; source: ExtensionInstallSource; }
export interface ExtensionInstallCommitRequest { request_id: string; transaction_id: string; approved_permissions: string[]; }
export interface ExtensionUninstallRequest { request_id: string; extension_id: string; version: string; }
export interface ExtensionLifecycleRequest { request_id: string; extension_id: string; version?: string; operation: 'start' | 'stop'; }
export interface ExtensionCommandRequest { request_id: string; command_id: string; args: unknown[]; }
export interface ExtensionRuntimeProjectionRequest { request_id: string; extension_id?: string; }

export interface SurfaceRequestFrame {
  kind: 'heartbeat' | 'chat_input' | 'audio_input' | 'avatar_presentation' | 'avatar_intent' | 'config_snapshot_request' | 'conversation_history_request' | 'skill_catalog_request' | 'config_update_request' | 'config_test_request' | 'extension_install_prepare' | 'extension_install_commit' | 'extension_install_cancel' | 'extension_uninstall_request' | 'extension_lifecycle_request' | 'extension_command_request' | 'extension_runtime_projection_request' | 'shutdown_request' | 'core_skill_action_response' | 'core_skill_confirmation_response';
  trace_id?: string; timestamp: number;
  chat_input?: { text: string; source_suffix?: string };
  audio_input?: { audio_id: string; audio_data: string; mime_type: string; duration_ms?: number; sample_rate?: number };
  avatar_presentation?: { placement_id?: string; display_scale?: number; reset_placement?: boolean };
  avatar_intent?: { action_id: string; operation: 'trigger' | 'activate' | 'deactivate'; priority?: number };
  config_snapshot_request?: ConfigurationSnapshotRequest;
  conversation_history_request?: ConversationHistoryRequest;
  skill_catalog_request?: { request_id: string };
  config_update_request?: ConfigurationUpdateRequest;
  config_test_request?: ConfigurationTestRequest;
  extension_install_prepare?: ExtensionInstallPrepareRequest;
  extension_install_commit?: ExtensionInstallCommitRequest;
  extension_install_cancel?: { request_id: string; transaction_id: string };
  extension_uninstall_request?: ExtensionUninstallRequest;
  extension_lifecycle_request?: ExtensionLifecycleRequest;
  extension_command_request?: ExtensionCommandRequest;
  extension_runtime_projection_request?: ExtensionRuntimeProjectionRequest;
  shutdown_request?: { requested_by: 'control-surface'; reason?: string };
  request_id?: string; status?: 'success' | 'error'; result?: unknown; message?: string;
  error_code?: string; operation_id?: string; recovery_actions?: string[];
}

export interface SurfaceProjectionFrame {
  kind: 'reply' | 'emotion' | 'thought' | 'audio_play' | 'audio_transcript' | 'character_presentation_projection' | 'avatar_status' | 'avatar_action_state' | 'runtime_readiness' | 'audio_status' | 'conversation_notice' | 'conversation_history_result' | 'configuration_snapshot_result' | 'configuration_update_result' | 'configuration_test_result' | 'skill_catalog_response' | 'extension_install_preview' | 'extension_install_result' | 'extension_uninstall_result' | 'extension_lifecycle_result' | 'extension_command_result' | 'extension_runtime_projection_result' | 'extension_runtime_projection_changed' | 'extension_status_changed' | 'core_skill_action_request' | 'core_skill_confirmation_request' | 'shutdown';
  trace_id?: string; timestamp: number;
  reply?: { text: string; messages?: ChannelReplyMessage[]; emotion_snapshot?: { emotion_type: string; intensity: number; trigger?: string; blend_time_ms?: number } };
  emotion?: { emotion_type: string; intensity: number; trigger?: string; blend_time_ms?: number };
  thought?: { active: boolean; hint?: string };
  audio_play?: { audio_id: string; audio_uri?: string; mime_type?: string; duration_ms?: number };
  audio_transcript?: { audio_id: string; status: 'success' | 'error'; text?: string; message?: string };
  character_presentation_projection?: { avatar_package_id: string; model_id: string; display_name: string; kind: 'live2d'; backend: 'unity'; host_kind: 'unity' | 'offline'; avatar_state: 'pending' | 'starting' | 'ready' | 'degraded' | 'stopped'; appearance: { placement_id?: string; display_scale: number }; lifecycle: { worker_window_state: 'isolated' | 'visible' | 'unknown'; composition_surface_state: 'attached' | 'failed' | 'unknown'; first_frame_presented: boolean; interaction_ready: boolean; ready: boolean; summary: string } };
  avatar_status?: { host_kind: 'unity' | 'offline'; host_id?: string };
  avatar_action_state?: { action_id?: string; state?: 'inactive' | 'active' | 'running' | 'completed' | 'rejected'; active_action_ids: string[]; message?: string };
  runtime_readiness?: { updated_at: number; runtimes: Array<{ runtime_id: string; owner: 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension'; phase: string; state: 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped'; blocking: boolean; summary: string; details_ref?: string; duration_ms?: number; reconciler?: { desired: string; actual: string; readiness: string; resources: Array<{ resource_id: string; resource_kind: string; desired_state: string; actual_state: string; readiness: string; summary: string; recovery_actions: string[] }> } }> };
  audio_status?: AudioStatusPayload;
  conversation_notice?: ConversationNotice;
  conversation_history_result?: ConversationHistoryResult;
  configuration_snapshot_result?: ConfigurationSnapshotResult;
  configuration_update_result?: ConfigurationUpdateResult;
  configuration_test_result?: ConfigurationTestResult;
  skill_catalog_response?: { request_id: string; status: 'success' | 'error'; snapshot?: unknown; message?: string };
  extension_install_preview?: { request_id: string; status: 'ready' | 'error'; transaction_id?: string; extension?: unknown; artifact?: unknown; trust?: unknown; message?: string };
  extension_install_result?: { request_id: string; status: 'success' | 'cancelled' | 'error'; extension_id?: string; version?: string; already_installed?: boolean; message?: string };
  extension_uninstall_result?: { request_id: string; extension_id: string; version: string; status: 'success' | 'error'; message?: string };
  extension_lifecycle_result?: { request_id: string; extension_id: string; version?: string; operation: 'start' | 'stop'; status: 'success' | 'error'; message?: string };
  extension_command_result?: { request_id: string; command_id: string; status: 'success' | 'error'; result?: unknown; message?: string };
  extension_runtime_projection_result?: { request_id: string; status: 'success' | 'error'; projections: ExtensionRuntimeProjection[]; installations: ExtensionInstallationProjection[]; message?: string };
  extension_runtime_projection_changed?: ExtensionRuntimeProjection;
  extension_status_changed?: { extension_id: string; event: 'loaded' | 'started' | 'stopped' | 'error'; message?: string };
  request_id?: string; action?: string; payload?: Record<string, unknown>;
  confirmation?: { trace_id: string; skill_id: string; target_kind: string; target_name: string; risk_level: string; side_effects: string[] };
}

export type PresentationFrameKind = SurfaceProjectionFrame['kind'];
