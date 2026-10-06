import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AuthorityConflictError, isAuthorityCurrent, validateAuthorityLease, validateAuthorityWindow,
  validateDrainReceipt, type AuthorityLease, type AuthorityRecord, type AuthorityStorePort,
  type AuthorityHandover, type AuthorityDrainReceipt } from '@glimmer-cradle/platform';

type TransferRow = { handover_json: string; receipt_json: string | null; target_lease_json: string | null };
function leaseDocument(lease: AuthorityLease): string {
  return JSON.stringify({ aggregate_id: lease.aggregate_id, owner_id: lease.owner_id, epoch: lease.epoch,
    fencing_token: lease.fencing_token, expires_at: lease.expires_at, revision: lease.revision });
}
function receiptDocument(receipt: AuthorityDrainReceipt): string {
  return JSON.stringify({ transfer_id: receipt.transfer_id, aggregate_id: receipt.aggregate_id,
    owner_id: receipt.owner_id, epoch: receipt.epoch, fencing_token: receipt.fencing_token, drained: receipt.drained });
}
function handoverDocument(handover: AuthorityHandover): string {
  return JSON.stringify({ transfer_id: handover.transfer_id, from: JSON.parse(leaseDocument(handover.from)),
    next_owner_id: handover.next_owner_id, prepared_revision: handover.prepared_revision });
}
function required(value: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new AuthorityConflictError('Authority identity 为空');
}

/** App 持久 Adapter；Platform 唯一拥有机制，DB 路径由 catalog/装配注入。 */
export class SqliteAuthorityStore implements AuthorityStorePort {
  private readonly database: Database.Database;
  public constructor(databasePath: string, migrationPath = resolve(__dirname, '../../../migrations/001-authority.sql')) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    try {
      this.database.pragma('busy_timeout=5000');
      const version = this.database.pragma('user_version', { simple: true });
      if (version === 0) {
        if (this.database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length) {
          throw new AuthorityConflictError('未知 Authority 数据库；须先受控迁移');
        }
        this.database.transaction(() => this.database.exec(readFileSync(migrationPath, 'utf8'))).immediate();
      } else if (version !== 1) throw new AuthorityConflictError('Authority schema 不兼容；须先受控迁移');
      if (this.database.pragma('application_id', { simple: true }) !== 0x47434155) {
        throw new AuthorityConflictError('Authority 数据库 owner 标记无效');
      }
      this.database.prepare('SELECT aggregate_id,epoch,status,revision FROM authority_aggregates LIMIT 0').all();
      this.database.prepare('SELECT handover_json,receipt_json,target_lease_json FROM authority_handovers LIMIT 0').all();
      this.database.pragma('foreign_keys=ON');
      this.database.pragma('journal_mode=WAL');
    } catch (error) { this.database.close(); throw error; }
  }
  public load(aggregateId: string): AuthorityRecord | null {
    required(aggregateId);
    const record = this.database.prepare('SELECT * FROM authority_aggregates WHERE aggregate_id=?').get(aggregateId) as AuthorityRecord | undefined;
    if (!record) return null;
    validateAuthorityLease(record);
    if (!['active', 'revoking', 'released'].includes(record.status)) throw new AuthorityConflictError('Authority state 无效');
    return record;
  }
  public acquire(aggregateId: string, ownerId: string, now: number, leaseMs: number): AuthorityLease {
    required(aggregateId); required(ownerId); validateAuthorityWindow(now, leaseMs);
    return this.database.transaction(() => {
      const current = this.load(aggregateId);
      this.assertTime(current, now);
      if (current && current.status !== 'released' && current.expires_at > now) {
        throw new AuthorityConflictError('Authority 仍被承载或正在撤销');
      }
      // 强制过期接管只 fencing，不证明旧业务没有副作用；消费 owner 仍须恢复 unknown。
      return this.activate(current, aggregateId, ownerId, now, leaseMs);
    }).immediate();
  }
  public renew(lease: AuthorityLease, now: number, leaseMs: number): AuthorityLease | null {
    validateAuthorityLease(lease); validateAuthorityWindow(now, leaseMs);
    return this.database.transaction(() => {
      const current = this.load(lease.aggregate_id);
      this.assertTime(current, now);
      if (!isAuthorityCurrent(current, lease, now) || current!.revision !== lease.revision) return null;
      const renewed = { ...lease, expires_at: Math.max(current!.expires_at, now + leaseMs), revision: lease.revision + 1 };
      validateAuthorityLease(renewed);
      this.database.prepare('UPDATE authority_aggregates SET expires_at=?,revision=?,updated_at=? WHERE aggregate_id=?')
        .run(renewed.expires_at, renewed.revision, now, lease.aggregate_id);
      return renewed;
    }).immediate();
  }
  public release(lease: AuthorityLease, now: number): boolean {
    validateAuthorityLease(lease); validateAuthorityWindow(now, 1);
    return this.database.transaction(() => {
      const current = this.load(lease.aggregate_id);
      this.assertTime(current, now);
      if (!current || current.owner_id !== lease.owner_id || current.epoch !== lease.epoch
        || current.fencing_token !== lease.fencing_token) return false;
      if (current.status === 'released') return true;
      if (current.status !== 'active' || current.revision !== lease.revision) return false;
      if (!Number.isSafeInteger(current.revision + 1)) throw new AuthorityConflictError('Authority revision 耗尽');
      this.database.prepare("UPDATE authority_aggregates SET status='released',revision=revision+1,updated_at=? WHERE aggregate_id=?")
        .run(now, lease.aggregate_id);
      return true;
    }).immediate();
  }
  public beginHandover(lease: AuthorityLease, nextOwnerId: string, transferId: string, now: number): AuthorityHandover {
    validateAuthorityLease(lease); required(nextOwnerId); required(transferId); validateAuthorityWindow(now, 1);
    if (nextOwnerId === lease.owner_id) throw new AuthorityConflictError('Authority 不转移到同一 owner');
    return this.database.transaction(() => {
      const existing = this.transfer(transferId);
      if (existing) {
        const accepted = JSON.parse(existing.handover_json) as AuthorityHandover;
        if (leaseDocument(accepted.from) !== leaseDocument(lease) || accepted.next_owner_id !== nextOwnerId) {
          throw new AuthorityConflictError('Authority transfer identity 内容冲突');
        }
        return accepted;
      }
      const current = this.load(lease.aggregate_id);
      this.assertTime(current, now);
      if (!isAuthorityCurrent(current, lease, now) || current!.revision !== lease.revision) {
        throw new AuthorityConflictError('Authority 旧租约不能发起转移');
      }
      const handover = { transfer_id: transferId, from: lease, next_owner_id: nextOwnerId, prepared_revision: lease.revision + 1 };
      if (!Number.isSafeInteger(handover.prepared_revision)) throw new AuthorityConflictError('Authority revision 耗尽');
      this.database.prepare("UPDATE authority_aggregates SET status='revoking',revision=?,updated_at=? WHERE aggregate_id=?")
        .run(handover.prepared_revision, now, lease.aggregate_id);
      this.database.prepare('INSERT INTO authority_handovers(transfer_id,aggregate_id,handover_json,prepared_at) VALUES(?,?,?,?)')
        .run(transferId, lease.aggregate_id, handoverDocument(handover), now);
      return JSON.parse(handoverDocument(handover)) as AuthorityHandover;
    }).immediate();
  }
  public completeHandover(handover: AuthorityHandover, receipt: AuthorityDrainReceipt, now: number, leaseMs: number): AuthorityLease {
    validateAuthorityLease(handover.from); validateDrainReceipt(handover, receipt); validateAuthorityWindow(now, leaseMs);
    return this.database.transaction(() => {
      const stored = this.transfer(handover.transfer_id);
      if (!stored || stored.handover_json !== handoverDocument(handover)) throw new AuthorityConflictError('Authority 转移依据丢失或冲突');
      const document = receiptDocument(receipt);
      if (stored.target_lease_json !== null) {
        if (stored.receipt_json !== document) throw new AuthorityConflictError('Authority drain identity 内容冲突');
        // 重复确认是原 receipt，不会刷新已结束/过期的新租约。
        return JSON.parse(stored.target_lease_json) as AuthorityLease;
      }
      const current = this.load(handover.from.aggregate_id);
      this.assertTime(current, now);
      if (!current || current.status !== 'revoking' || current.revision !== handover.prepared_revision
        || current.epoch !== handover.from.epoch || current.fencing_token !== handover.from.fencing_token
        || current.owner_id !== handover.from.owner_id) throw new AuthorityConflictError('Authority 转移已被更高 epoch 撤销');
      const next = this.activate(current, current.aggregate_id, handover.next_owner_id, now, leaseMs);
      this.database.prepare('UPDATE authority_handovers SET completed_at=?,receipt_json=?,target_lease_json=? WHERE transfer_id=?')
        .run(now, document, leaseDocument(next), handover.transfer_id);
      return next;
    }).immediate();
  }
  public close(): void { if (this.database.open) this.database.close(); }
  private transfer(id: string): TransferRow | undefined {
    return this.database.prepare('SELECT handover_json,receipt_json,target_lease_json FROM authority_handovers WHERE transfer_id=?')
      .get(id) as TransferRow | undefined;
  }
  private assertTime(record: AuthorityRecord | null, now: number): void {
    if (record && (!Number.isSafeInteger(record.updated_at) || now < record.updated_at)) {
      throw new AuthorityConflictError('Authority UTC 回退，拒绝写入');
    }
  }
  private activate(current: AuthorityRecord | null, aggregateId: string, ownerId: string, now: number, leaseMs: number): AuthorityLease {
    const lease = { aggregate_id: aggregateId, owner_id: ownerId, epoch: (current?.epoch ?? 0) + 1,
      fencing_token: (current?.fencing_token ?? 0) + 1, expires_at: now + leaseMs, revision: (current?.revision ?? 0) + 1 };
    validateAuthorityLease(lease);
    this.database.prepare(`INSERT INTO authority_aggregates VALUES(?,?,?,?,?,?,'active',?) ON CONFLICT(aggregate_id)
      DO UPDATE SET owner_id=excluded.owner_id,epoch=excluded.epoch,fencing_token=excluded.fencing_token,
      expires_at=excluded.expires_at,revision=excluded.revision,status='active',updated_at=excluded.updated_at`)
      .run(aggregateId, ownerId, lease.epoch, lease.fencing_token, lease.expires_at, lease.revision, now);
    return lease;
  }
}
