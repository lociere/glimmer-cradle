import {
  RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE,
  RECOVERY_REQUIRED_ERROR_CODE,
  type RecoveryAction,
} from '../kernel-contracts';

export { RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE };
export type { RecoveryAction };

/** 副作用可能已提交且不可安全重放时，跨 Adapter 保留的应用层终态。 */
export class RecoveryRequiredError extends Error {
  public readonly code = RECOVERY_REQUIRED_ERROR_CODE;

  public constructor(
    public readonly operationId: string,
    public readonly recoveryActions: readonly RecoveryAction[] = [RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE],
    message = `副作用终态不明，需要人工恢复（operation_id=${operationId}）`,
  ) {
    super(message);
    this.name = 'RecoveryRequiredError';
    Object.setPrototypeOf(this, RecoveryRequiredError.prototype);
  }
}
