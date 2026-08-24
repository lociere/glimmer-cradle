const RECOVERY_REQUIRED_ERROR_CODE = 'recovery_required' as const;
const RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE = 'confirm_side_effect_state' as const;

export interface CoreSkillFailureProjection {
  error_code: typeof RECOVERY_REQUIRED_ERROR_CODE;
  operation_id: string;
  recovery_actions: readonly (typeof RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE)[];
}

export function manualRecoveryProjection(operationId: string): CoreSkillFailureProjection {
  return {
    error_code: RECOVERY_REQUIRED_ERROR_CODE,
    operation_id: operationId,
    recovery_actions: [RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE],
  };
}

export function buildCoreSkillResponseFrame(
  kind: 'core_skill_action_response' | 'core_skill_confirmation_response',
  requestId: string,
  status: 'success' | 'error',
  result?: unknown,
  message?: string,
  failure?: CoreSkillFailureProjection,
): Record<string, unknown> {
  return {
    kind,
    request_id: requestId,
    status,
    result,
    message,
    error_code: failure?.error_code,
    operation_id: failure?.operation_id,
    recovery_actions: failure?.recovery_actions,
    timestamp: Date.now(),
  };
}
