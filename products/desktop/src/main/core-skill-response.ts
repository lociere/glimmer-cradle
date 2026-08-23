import {
  RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE,
  RECOVERY_REQUIRED_ERROR_CODE,
  type RecoveryRequiredProjection,
} from '@glimmer-cradle/protocol';

export type CoreSkillFailureProjection = RecoveryRequiredProjection;

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
