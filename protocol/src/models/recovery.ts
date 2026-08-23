export const RECOVERY_REQUIRED_ERROR_CODE = 'recovery_required' as const;
export const RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE = 'confirm_side_effect_state' as const;

export type RecoveryAction = typeof RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE;

/** 现有 Surface 边界使用的稳定人工恢复投影；message 不参与程序判断。 */
export interface RecoveryRequiredProjection {
  readonly error_code: typeof RECOVERY_REQUIRED_ERROR_CODE;
  readonly operation_id: string;
  readonly recovery_actions: readonly RecoveryAction[];
}
