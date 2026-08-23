/**
 * Domain-owned event vocabulary.
 *
 * Protocol serializers translate these structural records at Adapter edges. Domain must
 * not import generated or transport-owned schema packages merely to name an event.
 */
export type ErrorCode = string;

export interface TraceContext {
  readonly trace_id: string;
  readonly parent_span_id?: string | null;
  readonly causation_id?: string | null;
  readonly correlation_id?: string | null;
}

export interface VisualCommand {
  readonly trace_id: string;
  readonly command_type: 'set_expression' | 'play_motion' | 'lip_sync' | 'set_parameter' | 'play_audio' | 'idle';
  readonly timestamp: number;
  readonly expression?: { readonly expression_id: string; readonly blend_time_ms?: number; readonly auto_reset?: boolean };
  readonly motion?: { readonly motion_id: string; readonly motion_group?: string | null; readonly loop?: boolean; readonly priority?: number };
  readonly lip_sync?: {
    readonly phoneme?: string;
    readonly weight?: number;
    readonly duration_ms?: number;
  };
  readonly parameter?: {
    readonly parameters: ReadonlyArray<{ readonly name: string; readonly value: number }>;
    readonly blend_time_ms?: number;
  };
  readonly audio?: {
    readonly audio_id: string;
    readonly audio_uri?: string | null;
    readonly audio_data?: string | null;
    readonly mime_type?: string;
    readonly duration_ms?: number;
  };
  readonly emotion_state?: {
    readonly emotion_type?: string;
    readonly intensity?: number;
    readonly trigger?: string | null;
  };
  readonly [field: string]: unknown;
}

export interface AvatarActionState {
  readonly active_action_ids: string[];
}

export interface PresentationUpstreamFrame {
  readonly kind: string;
  readonly trace_id?: string;
  readonly avatar_action_state?: AvatarActionState;
  readonly [field: string]: unknown;
}

export interface ChannelReplyMessage {
  readonly sequence: number;
  readonly content_type: 'text' | 'code';
  readonly text: string;
  readonly language?: string | null;
}

export interface ChannelReplyPayload {
  readonly target_channel: string;
  readonly text: string;
  readonly messages?: readonly ChannelReplyMessage[];
  readonly trace_id: string;
  readonly emotion_state?: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}
export const RECOVERY_REQUIRED_ERROR_CODE = 'recovery_required' as const;
export const RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE = 'confirm_side_effect_state' as const;
export type RecoveryAction = typeof RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE;
