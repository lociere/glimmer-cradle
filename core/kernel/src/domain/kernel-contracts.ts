/**
 * Domain-owned event vocabulary.
 *
 * Protocol serializers translate these structural records at Adapter edges. Domain must
 * not import generated or transport-owned schema packages merely to name an event.
 */
export type ErrorCode = string;
export type TraceContext = any;
export type VisualCommand = any;
export type PresentationUpstreamFrame = any;
export type ChannelReplyPayload = any;
export const RECOVERY_REQUIRED_ERROR_CODE = 'recovery_required' as const;
export const RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE = 'confirm_side_effect_state' as const;
export type RecoveryAction = typeof RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE;
