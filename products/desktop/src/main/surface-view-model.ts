import type { PresentationDownstreamFrame } from '@glimmer-cradle/extension-sdk';

export interface AvatarActionStateDocument { active_action_ids: string[] }

export type RuntimeReadinessOwner = 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension';
export type RuntimeReadinessState = 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped';
export type RuntimeResourceState = 'pending' | 'ready' | 'missing' | 'degraded' | 'failed' | 'unknown';
export interface RuntimeResourceSnapshot {
  resource_id: string; resource_kind: string; desired_state: RuntimeResourceState;
  actual_state: RuntimeResourceState; readiness: RuntimeResourceState; summary: string;
  recovery_actions: string[];
}
export interface RuntimeReconcilerSnapshot {
  desired: string; actual: string; readiness: RuntimeResourceState; resources: RuntimeResourceSnapshot[];
}
export interface RuntimeReadinessSnapshot {
  runtime_id: string; owner: RuntimeReadinessOwner; phase: string; state: RuntimeReadinessState;
  blocking: boolean; summary: string; details_ref?: string; duration_ms?: number;
  reconciler?: RuntimeReconcilerSnapshot;
}
export interface RuntimeReadinessCatalog { updated_at: number; runtimes: RuntimeReadinessSnapshot[] }

export type PresentationFrameKind = PresentationDownstreamFrame['kind'];
export type PresentationFrameClass = 'expression_flow' | 'avatar_control' | 'presentation_state';
const FRAME_CLASS_BY_KIND: Record<PresentationFrameKind, PresentationFrameClass> = {
  thought: 'expression_flow', reply: 'expression_flow', emotion: 'expression_flow',
  audio_play: 'avatar_control', expression: 'avatar_control', motion: 'avatar_control',
  lip_sync: 'avatar_control', parameter: 'avatar_control', avatar_intent: 'avatar_control',
  avatar_action_state: 'avatar_control', presentation: 'avatar_control', idle: 'avatar_control',
  character_presentation_projection: 'presentation_state', avatar_status: 'presentation_state',
  runtime_readiness: 'presentation_state', audio_status: 'presentation_state',
  audio_transcript: 'presentation_state', conversation_notice: 'presentation_state',
  conversation_history_result: 'presentation_state', skill_catalog_response: 'presentation_state',
  configuration_snapshot_result: 'presentation_state', configuration_update_result: 'presentation_state',
  configuration_test_result: 'presentation_state', extension_install_preview: 'presentation_state',
  extension_install_result: 'presentation_state', extension_uninstall_result: 'presentation_state',
  extension_lifecycle_result: 'presentation_state', extension_command_result: 'presentation_state',
  extension_runtime_projection_result: 'presentation_state', extension_runtime_projection_changed: 'presentation_state',
  extension_status_changed: 'presentation_state', shutdown: 'presentation_state',
  load_scene: 'presentation_state', unload_scene: 'presentation_state', ping: 'presentation_state',
};
export function isPresentationFrameKind(value: string): value is PresentationFrameKind {
  return Object.prototype.hasOwnProperty.call(FRAME_CLASS_BY_KIND, value);
}
export function getPresentationFrameClass(kind: PresentationFrameKind): PresentationFrameClass {
  return FRAME_CLASS_BY_KIND[kind];
}
