import type { AuthorityLease, AuthorityRecord } from './authority-lease.js';

export interface AuthorityHandover {
  readonly transfer_id: string;
  readonly from: AuthorityLease;
  readonly next_owner_id: string;
  readonly prepared_revision: number;
}
/** 可信承载 owner 在撤销入口并完成在途资源 drain 后产生；不是网络/模型自报证据。 */
export interface AuthorityDrainReceipt {
  readonly transfer_id: string;
  readonly aggregate_id: string;
  readonly owner_id: string;
  readonly epoch: number;
  readonly fencing_token: number;
  readonly drained: true;
}
export interface AuthorityStorePort {
  acquire(aggregateId: string, ownerId: string, now: number, leaseMs: number): AuthorityLease;
  load(aggregateId: string): AuthorityRecord | null;
  renew(lease: AuthorityLease, now: number, leaseMs: number): AuthorityLease | null;
  release(lease: AuthorityLease, now: number): boolean;
  beginHandover(lease: AuthorityLease, nextOwnerId: string, transferId: string, now: number): AuthorityHandover;
  completeHandover(handover: AuthorityHandover, receipt: AuthorityDrainReceipt, now: number, leaseMs: number): AuthorityLease;
}
export interface AuthorityDrainPort {
  revokeAndDrain(handover: AuthorityHandover): Promise<AuthorityDrainReceipt>;
}
