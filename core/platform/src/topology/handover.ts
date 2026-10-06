import type { AuthorityLease } from './authority-lease.js';
import { AuthorityConflictError, validateAuthorityWindow } from './authority-lease.js';
import type { AuthorityDrainPort, AuthorityDrainReceipt, AuthorityHandover, AuthorityStorePort } from './authority.js';

export function validateDrainReceipt(handover: AuthorityHandover, receipt: AuthorityDrainReceipt): void {
  const from = handover.from;
  if (receipt.drained !== true || receipt.transfer_id !== handover.transfer_id
    || receipt.aggregate_id !== from.aggregate_id || receipt.owner_id !== from.owner_id
    || receipt.epoch !== from.epoch || receipt.fencing_token !== from.fencing_token) {
    throw new AuthorityConflictError('Authority drain 确认身份不匹配');
  }
}

/** 机制不认识 Jobs/Memory；转移失败保留 revoking，不能恢复旧写入口或伪造 drain。 */
export class HandoverController {
  public constructor(private readonly store: AuthorityStorePort, private readonly clock: { now(): number }) {}
  public async transfer(lease: AuthorityLease, nextOwnerId: string, transferId: string,
    drain: AuthorityDrainPort, leaseMs: number): Promise<AuthorityLease> {
    const now = this.clock.now();
    validateAuthorityWindow(now, leaseMs);
    const handover = this.store.beginHandover(lease, nextOwnerId, transferId, now);
    const receipt = await drain.revokeAndDrain(handover);
    validateDrainReceipt(handover, receipt);
    return this.store.completeHandover(handover, receipt, this.clock.now(), leaseMs);
  }
}
