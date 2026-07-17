import type { PresentationDownstreamFrame } from '../generated/models/PresentationDownstreamFrame';

export type PresentationFrameKind = PresentationDownstreamFrame['kind'];

export type PresentationFrameClass =
  | 'expression_flow'
  | 'avatar_control'
  | 'presentation_state';

export const PRESENTATION_EXPRESSION_FLOW_KINDS = [
  'thought',
  'reply',
  'emotion',
] as const satisfies readonly PresentationFrameKind[];

export const PRESENTATION_AVATAR_CONTROL_KINDS = [
  'audio_play',
  'expression',
  'motion',
  'lip_sync',
  'parameter',
  'avatar_intent',
  'avatar_action_state',
  'presentation',
  'character_presentation_projection',
  'idle',
] as const satisfies readonly PresentationFrameKind[];

export const PRESENTATION_STATE_KINDS = [
  'avatar_status',
  'character_presentation_projection',
  'runtime_readiness',
  'audio_status',
  'audio_transcript',
  'extension_install_preview',
  'extension_install_result',
  'extension_uninstall_result',
  'extension_lifecycle_result',
  'extension_command_result',
  'extension_runtime_projection_result',
  'extension_runtime_projection_changed',
  'extension_status_changed',
  'shutdown',
  'load_scene',
  'unload_scene',
  'ping',
] as const satisfies readonly PresentationFrameKind[];

const FRAME_CLASS_BY_KIND: Record<PresentationFrameKind, PresentationFrameClass> = {
  thought: 'expression_flow',
  reply: 'expression_flow',
  emotion: 'expression_flow',
  audio_play: 'avatar_control',
  expression: 'avatar_control',
  motion: 'avatar_control',
  lip_sync: 'avatar_control',
  parameter: 'avatar_control',
  avatar_intent: 'avatar_control',
  avatar_action_state: 'avatar_control',
  presentation: 'avatar_control',
  character_presentation_projection: 'presentation_state',
  idle: 'avatar_control',
  avatar_status: 'presentation_state',
  runtime_readiness: 'presentation_state',
  audio_status: 'presentation_state',
  audio_transcript: 'presentation_state',
  extension_install_preview: 'presentation_state',
  extension_install_result: 'presentation_state',
  extension_uninstall_result: 'presentation_state',
  extension_lifecycle_result: 'presentation_state',
  extension_command_result: 'presentation_state',
  extension_runtime_projection_result: 'presentation_state',
  extension_runtime_projection_changed: 'presentation_state',
  extension_status_changed: 'presentation_state',
  shutdown: 'presentation_state',
  load_scene: 'presentation_state',
  unload_scene: 'presentation_state',
  ping: 'presentation_state',
};

export function isPresentationFrameKind(value: string): value is PresentationFrameKind {
  return Object.prototype.hasOwnProperty.call(FRAME_CLASS_BY_KIND, value);
}

/**
 * Presentation Plane 下行帧的语义分类，不按 Electron、Live2D 或 Unity 实现分组。
 */
export function getPresentationFrameClass(kind: PresentationFrameKind): PresentationFrameClass {
  return FRAME_CLASS_BY_KIND[kind];
}

export function isPresentationExpressionFlowKind(kind: PresentationFrameKind): boolean {
  return getPresentationFrameClass(kind) === 'expression_flow';
}

export function isPresentationAvatarControlKind(kind: PresentationFrameKind): boolean {
  return getPresentationFrameClass(kind) === 'avatar_control';
}

export function isPresentationStateKind(kind: PresentationFrameKind): boolean {
  return getPresentationFrameClass(kind) === 'presentation_state';
}
