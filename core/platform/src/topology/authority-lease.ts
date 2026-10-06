export interface AuthorityLease {
  readonly aggregate_id: string;
  readonly owner_id: string;
  readonly epoch: number;
  readonly fencing_token: number;
  readonly expires_at: number;
  readonly revision: number;
}
export interface AuthorityRecord extends AuthorityLease {
  readonly status: 'active' | 'revoking' | 'released';
  readonly updated_at: number;
}
export class AuthorityConflictError extends Error {}

export function validateAuthorityWindow(now: number, leaseMs: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 1
    || !Number.isSafeInteger(now + leaseMs)) throw new AuthorityConflictError('Authority UTC/租约窗口无效');
}
export function validateAuthorityLease(lease: AuthorityLease): void {
  if (![lease.aggregate_id, lease.owner_id].every(value => typeof value === 'string' && !!value.trim())
    || ![lease.epoch, lease.fencing_token, lease.expires_at, lease.revision]
      .every(value => Number.isSafeInteger(value) && value > 0)) throw new AuthorityConflictError('Authority lease identity 无效');
}
export function isAuthorityCurrent(record: AuthorityRecord | null, lease: AuthorityLease, now: number): boolean {
  validateAuthorityWindow(now, 1);
  validateAuthorityLease(lease);
  // revision/到期可因合法续期推进；epoch/token/owner 才是这次承载的不可替换身份。
  return record !== null && record.status === 'active' && record.expires_at > now
    && record.aggregate_id === lease.aggregate_id && record.owner_id === lease.owner_id
    && record.epoch === lease.epoch && record.fencing_token === lease.fencing_token;
}
