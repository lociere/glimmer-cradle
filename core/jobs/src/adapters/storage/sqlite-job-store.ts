import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JobAuthorityError, JobConflictError, validateJobRequest, type Job, type JobAttempt,
  type JobReconciliationEvidence, type JobReconciliationReceipt, type JobRequest, type JobStateEvent } from '../../execution/job.js';
import type { JobClaim, JobFinish, JobStorePort, JobSubmission } from '../../ports/job-store-port.js';
import { retryDelay, type RetryPolicy } from '../../recovery/retry-policy.js';
import { validateLeaseWindow, type JobLease } from '../../scheduling/job-lease.js';
import { initialScheduleDue, scheduledOccurrence } from '../../scheduling/schedule.js';
import { validateTriggerDefinition, type JobTrigger, type JobTriggerDefinition, type JobTriggerEvent } from '../../triggers/trigger.js';

type JobRow = Omit<Job, 'payload' | 'result'> & { payload_json: string; result_json: string | null; request_digest: string };
type Tombstone = { job_id: string; scope_id: string; idempotency_key: string; request_digest: string; revision: number };
type TriggerRow = Omit<JobTrigger, 'definition' | 'enabled'> & {
  trigger_id: string; definition_json: string; definition_digest: string; enabled: number;
};
type OccurrenceRow = { occurrence_digest: string; job_id: string };

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || !value || seen.has(value)) throw new JobConflictError('Job JSON 值无效');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, seen)).join(',')}]`;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new JobConflictError('Job JSON object 无效');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}

function assertTimestamp(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Job UTC 时间无效');
}

/** 路径由 App 注入；所有竞争写入在 IMMEDIATE transaction 中完成，不持有跨 await 的事务。 */
export class SqliteJobStore implements JobStorePort {
  private readonly database: Database.Database;

  public constructor(databasePath: string, migrationPath = resolve(__dirname, '../../../migrations/001-jobs.sql')) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    try {
      this.database.pragma('busy_timeout = 5000');
      const version = this.database.pragma('user_version', { simple: true });
      if (version === 0) {
        if (this.database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length) {
          throw new Error('未知 Jobs 数据库；须先执行受控迁移');
        }
        this.database.transaction(() => this.database.exec(readFileSync(migrationPath, 'utf8'))).immediate();
      } else if (version !== 3) throw new Error('Jobs schema version 不兼容；须先执行受控迁移');
      if (this.database.pragma('application_id', { simple: true }) !== 0x47434a42) {
        throw new Error('Jobs 数据库 owner 标记无效');
      }
      this.database.prepare('SELECT epoch FROM job_authority').all();
      this.database.prepare('SELECT job_id,request_digest,status,fencing_token FROM jobs LIMIT 0').all();
      this.database.prepare('SELECT definition_json,next_due_at FROM job_triggers LIMIT 0').all();
      this.database.prepare('SELECT job_id,attempt,authority_epoch,fencing_token FROM job_attempts LIMIT 0').all();
      this.database.prepare('SELECT source_id,evidence_id,evidence_digest FROM job_reconciliations LIMIT 0').all();
      this.database.prepare('SELECT event_id,event_json,acknowledged_at FROM job_outbox LIMIT 0').all();
      this.database.pragma('foreign_keys = ON');
      this.database.pragma('journal_mode = WAL');
    } catch (error) { this.database.close(); throw error; }
  }

  public loadAuthorityEpoch(): number | null {
    const epoch = this.currentEpoch();
    if (epoch !== null && (!Number.isSafeInteger(epoch) || epoch < 1)) throw new JobAuthorityError('Job authority 持久序列无效');
    return epoch;
  }

  public activateAuthority(epoch: number, now: number): void {
    assertTimestamp(now);
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new JobAuthorityError('Job authority epoch 无效');
    this.database.transaction(() => {
      const current = this.currentEpoch();
      if (current !== null && epoch < current) throw new JobAuthorityError('旧 Job authority 不得重新激活');
      if (epoch === current) return;
      const changed = this.database.prepare("SELECT * FROM jobs WHERE status IN ('running','queued','retry_wait','unknown')").all() as JobRow[];
      this.database.prepare('INSERT INTO job_authority VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET epoch=excluded.epoch').run(epoch);
      // 旧 owner 可能已经产生外部副作用；handover 不能猜测成功或自动重复执行。
      for (const job of changed) if (job.status === 'running') this.endAttempt(job, 'unknown', 'authority_changed', now);
      this.database.prepare(`UPDATE jobs SET status='unknown',authority_epoch=?,fencing_token=fencing_token+1,
        revision=revision+1,lease_owner=NULL,lease_until=NULL,error_code='authority_changed',updated_at=? WHERE status='running'`).run(epoch, now);
      this.database.prepare(`UPDATE jobs SET authority_epoch=?,revision=revision+1,updated_at=?
        WHERE status IN ('queued','retry_wait','unknown') AND authority_epoch<>?`).run(epoch, now, epoch);
      for (const job of changed) this.appendState(job.job_id);
    }).immediate();
  }

  public enqueue(request: JobRequest, epoch: number, now: number): JobSubmission {
    validateJobRequest(request);
    assertTimestamp(now);
    const identity = { scope_id: request.scope_id, goal_id: request.goal_id, kind: request.kind,
      idempotency_key: request.idempotency_key, payload: request.payload, due_at: request.due_at,
      retry_mode: request.retry_mode, max_attempts: request.max_attempts };
    const digest = createHash('sha256').update(canonicalJson(identity)).digest('hex');
    const payload = canonicalJson(request.payload);
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const existing = this.database.prepare('SELECT * FROM jobs WHERE job_id=? OR (scope_id=? AND idempotency_key=?)')
        .all(request.job_id, request.scope_id, request.idempotency_key) as JobRow[];
      const retired = this.database.prepare('SELECT * FROM job_tombstones WHERE job_id=? OR (scope_id=? AND idempotency_key=?)')
        .all(request.job_id, request.scope_id, request.idempotency_key) as Tombstone[];
      if (existing.length + retired.length > 1) throw new JobConflictError('Job identity 指向不同工作');
      if (existing[0]) {
        this.assertSameRequest(existing[0], request, digest);
        const job = this.decode(existing[0]);
        return { job, job_id: job.job_id, revision: job.revision, duplicate: true };
      }
      if (retired[0]) {
        this.assertSameRequest(retired[0], request, digest);
        return { job: null, job_id: retired[0].job_id, revision: retired[0].revision, duplicate: true };
      }
      this.database.prepare(`INSERT INTO jobs(job_id,scope_id,goal_id,kind,idempotency_key,payload_json,request_digest,
        due_at,retry_mode,max_attempts,status,revision,attempt,authority_epoch,fencing_token,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'queued',1,0,?,0,?,?)`).run(request.job_id, request.scope_id, request.goal_id, request.kind,
          request.idempotency_key, payload, digest, request.due_at, request.retry_mode, request.max_attempts, epoch, now, now);
      this.appendState(request.job_id);
      return { job: this.load(request.job_id)!, job_id: request.job_id, revision: 1, duplicate: false };
    }).immediate();
  }

  public load(jobId: string): Job | null {
    const row = this.database.prepare('SELECT * FROM jobs WHERE job_id=?').get(jobId) as JobRow | undefined;
    return row ? this.decode(row) : null;
  }

  public listAttempts(jobId: string): JobAttempt[] {
    return this.database.prepare('SELECT * FROM job_attempts WHERE job_id=? ORDER BY attempt').all(jobId) as JobAttempt[];
  }

  public readOutbox(epoch: number, limit: number): JobStateEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Job outbox batch limit 无效');
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const rows = this.database.prepare(`SELECT event_json FROM job_outbox WHERE acknowledged_at IS NULL
        ORDER BY created_at,job_id,revision LIMIT ?`).all(limit) as { event_json: string }[];
      return rows.map(row => JSON.parse(row.event_json) as JobStateEvent);
    }).deferred();
  }

  public listUnknown(epoch: number, kind: string, limit: number, afterJobId = ''): Job[] {
    if (!kind.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new JobConflictError('Job unknown 扫描范围无效');
    }
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const rows = this.database.prepare(`SELECT * FROM jobs WHERE status='unknown' AND kind=? AND job_id>?
        ORDER BY job_id LIMIT ?`).all(kind, afterJobId, limit) as JobRow[];
      return rows.map(row => this.decode(row));
    }).deferred();
  }

  public acknowledgeOutbox(eventId: string, epoch: number, now: number): boolean {
    assertTimestamp(now);
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const event = this.database.prepare('SELECT created_at FROM job_outbox WHERE event_id=?')
        .get(eventId) as { created_at: number } | undefined;
      if (!event) return false;
      if (now < event.created_at) throw new Error('Job outbox ACK 时间无效');
      this.database.prepare('UPDATE job_outbox SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE event_id=?').run(now, eventId);
      return true;
    }).immediate();
  }

  public reconcile(evidence: JobReconciliationEvidence, epoch: number, expectedRevision: number, now: number,
    policy: RetryPolicy): JobReconciliationReceipt {
    assertTimestamp(now);
    assertTimestamp(evidence.observed_at);
    retryDelay(1, policy);
    if (![evidence.source_id, evidence.evidence_id, evidence.job_id, evidence.scope_id, evidence.owner_id]
      .every(value => typeof value === 'string' && !!value.trim())
      || ![evidence.attempt, evidence.authority_epoch, evidence.fencing_token, expectedRevision]
        .every(value => Number.isSafeInteger(value) && value > 0)
      || evidence.observed_at > now
      || !['applied', 'not_applied', 'failed'].includes(evidence.resolution)) {
      throw new JobConflictError('Job reconciliation evidence 无效');
    }
    if (evidence.resolution === 'not_applied' && evidence.receiver_fenced !== true) {
      throw new JobConflictError('Job not-applied 必须封口原 attempt');
    }
    if (evidence.resolution === 'failed' && !/^[a-z][a-z0-9_.:-]{0,127}$/.test(evidence.error_code)) {
      throw new JobConflictError('Job reconciliation error code 无效');
    }
    if (evidence.resolution === 'applied' && (!evidence.result || typeof evidence.result !== 'object' || Array.isArray(evidence.result))) {
      throw new JobConflictError('Job reconciliation result 必须是 JSON object');
    }
    const document = canonicalJson(evidence);
    const digest = createHash('sha256').update(document).digest('hex');
    return this.database.transaction((): JobReconciliationReceipt => {
      this.assertAuthority(epoch);
      const accepted = this.database.prepare('SELECT evidence_digest FROM job_reconciliations WHERE source_id=? AND evidence_id=?')
        .get(evidence.source_id, evidence.evidence_id) as { evidence_digest: string } | undefined;
      if (accepted) {
        if (accepted.evidence_digest !== digest) throw new JobConflictError('Job evidence identity 内容冲突');
        return { status: 'duplicate', job: this.load(evidence.job_id) };
      }
      const job = this.load(evidence.job_id);
      if (!job || job.status !== 'unknown' || job.revision !== expectedRevision || job.authority_epoch !== epoch) {
        return { status: 'stale', job };
      }
      const attempt = this.listAttempts(job.job_id).find(value => value.attempt === job.attempt);
      if (!attempt || attempt.status !== 'unknown' || evidence.scope_id !== job.scope_id
        || evidence.attempt !== attempt.attempt || evidence.authority_epoch !== attempt.authority_epoch
        || evidence.fencing_token !== attempt.fencing_token || evidence.owner_id !== attempt.owner_id
        || evidence.observed_at < attempt.started_at) throw new JobConflictError('Job evidence 不属于当前 unknown attempt');
      const status = evidence.resolution === 'applied' ? 'succeeded'
        : evidence.resolution === 'not_applied' && job.attempt < job.max_attempts ? 'retry_wait' : 'dead_letter';
      const due = status === 'retry_wait' ? now + retryDelay(job.attempt, policy) : job.due_at;
      assertTimestamp(due);
      const error = evidence.resolution === 'failed' ? evidence.error_code
        : evidence.resolution === 'not_applied' ? 'reconciled_not_applied' : null;
      const result = evidence.resolution === 'applied' ? canonicalJson(evidence.result) : null;
      this.database.prepare(`UPDATE jobs SET status=?,revision=revision+1,due_at=?,error_code=?,result_json=?,updated_at=? WHERE job_id=?`)
        .run(status, due, error, result, now, job.job_id);
      this.endAttempt(job, status, error, now);
      this.database.prepare('INSERT INTO job_reconciliations VALUES(?,?,?,?,?,?,?)')
        .run(evidence.source_id, evidence.evidence_id, digest, job.job_id, job.attempt, job.revision + 1, now);
      this.appendState(job.job_id);
      return { status: 'accepted', job: this.load(job.job_id) };
    }).immediate();
  }

  public claim(epoch: number, ownerId: string, now: number, leaseMs: number, kind?: string): JobClaim | null {
    validateLeaseWindow(now, leaseMs);
    if (!ownerId.trim()) throw new Error('Job lease owner 不得为空');
    if (kind !== undefined && !kind.trim()) throw new JobConflictError('Job claim kind 无效');
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const row = this.database.prepare(`SELECT * FROM jobs WHERE status IN ('queued','retry_wait') AND due_at<=?
        AND attempt<max_attempts AND (? IS NULL OR kind=?) ORDER BY due_at,created_at,job_id LIMIT 1`)
        .get(now, kind ?? null, kind ?? null) as JobRow | undefined;
      if (!row) return null;
      this.database.prepare(`UPDATE jobs SET status='running',revision=revision+1,attempt=attempt+1,
        fencing_token=fencing_token+1,authority_epoch=?,lease_owner=?,lease_until=?,updated_at=? WHERE job_id=?`)
        .run(epoch, ownerId, now + leaseMs, now, row.job_id);
      const job = this.load(row.job_id)!;
      this.database.prepare(`INSERT INTO job_attempts(job_id,attempt,authority_epoch,fencing_token,owner_id,
        started_at,lease_until,status) VALUES(?,?,?,?,?,?,?,'running')`)
        .run(job.job_id, job.attempt, epoch, job.fencing_token, ownerId, now, now + leaseMs);
      this.appendState(job.job_id);
      return { job, lease: { job_id: job.job_id, authority_epoch: epoch, fencing_token: job.fencing_token, owner_id: ownerId } };
    }).immediate();
  }

  public isLeaseCurrent(lease: JobLease, now: number): boolean {
    assertTimestamp(now);
    return this.currentEpoch() === lease.authority_epoch && !!this.database.prepare(`SELECT job_id FROM jobs
      WHERE job_id=? AND status='running' AND authority_epoch=? AND fencing_token=? AND lease_owner=? AND lease_until>?`)
      .get(lease.job_id, lease.authority_epoch, lease.fencing_token, lease.owner_id, now);
  }

  public renew(lease: JobLease, now: number, leaseMs: number): boolean {
    validateLeaseWindow(now, leaseMs);
    return this.database.transaction(() => {
      if (!this.isLeaseCurrent(lease, now)) return false;
      this.database.prepare('UPDATE jobs SET lease_until=MAX(lease_until,?),revision=revision+1,updated_at=? WHERE job_id=?')
        .run(now + leaseMs, now, lease.job_id);
      const job = this.load(lease.job_id)!;
      if (this.database.prepare('UPDATE job_attempts SET lease_until=? WHERE job_id=? AND attempt=?')
        .run(job.lease_until, job.job_id, job.attempt).changes !== 1) throw new Error('Job attempt 持久依据丢失');
      return true;
    }).immediate();
  }

  public finish(lease: JobLease, now: number, outcome: JobFinish): boolean {
    assertTimestamp(now);
    if (!['succeeded', 'retry_wait', 'dead_letter', 'unknown'].includes(outcome.status)
      || (outcome.error_code !== undefined && !/^[a-z][a-z0-9_.:-]{0,127}$/.test(outcome.error_code))) {
      throw new Error('Job terminal outcome 无效');
    }
    const result = outcome.result === undefined ? null : canonicalJson(outcome.result);
    if (outcome.result !== undefined && (!outcome.result || typeof outcome.result !== 'object' || Array.isArray(outcome.result))) {
      throw new Error('Job result 必须是 JSON object');
    }
    return this.database.transaction(() => {
      if (!this.isLeaseCurrent(lease, now)) return false;
      const job = this.load(lease.job_id)!;
      if (outcome.status === 'retry_wait' && (job.retry_mode !== 'idempotent' || job.attempt >= job.max_attempts
        || outcome.next_due_at === undefined || !Number.isSafeInteger(outcome.next_due_at) || outcome.next_due_at < now)) {
        throw new Error('Job 不允许自动重试');
      }
      this.database.prepare(`UPDATE jobs SET status=?,revision=revision+1,lease_owner=NULL,lease_until=NULL,
        due_at=?,error_code=?,result_json=?,updated_at=? WHERE job_id=?`).run(outcome.status,
          outcome.next_due_at ?? job.due_at, outcome.error_code ?? null, result, now, job.job_id);
      this.endAttempt(job, outcome.status, outcome.error_code ?? null, now);
      this.appendState(job.job_id);
      return true;
    }).immediate();
  }

  public cancel(jobId: string, epoch: number, expectedRevision: number, now: number): Job | null {
    assertTimestamp(now);
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const previous = this.load(jobId);
      const changes = this.database.prepare(`UPDATE jobs SET status='cancelled',revision=revision+1,
        fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,error_code='cancelled',updated_at=?
        WHERE job_id=? AND revision=? AND status IN ('queued','retry_wait','running')`).run(now, jobId, expectedRevision).changes;
      if (changes) {
        if (previous?.status === 'running') this.endAttempt(previous, 'cancelled', 'cancelled', now);
        this.appendState(jobId);
      }
      return changes ? this.load(jobId) : null;
    }).immediate();
  }

  public recoverExpired(epoch: number, now: number, policy: RetryPolicy): number {
    assertTimestamp(now);
    retryDelay(1, policy);
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const expired = this.database.prepare("SELECT * FROM jobs WHERE status='running' AND lease_until<=?").all(now) as JobRow[];
      for (const job of expired) {
        const status = job.retry_mode !== 'idempotent' ? 'unknown' : job.attempt < job.max_attempts ? 'retry_wait' : 'dead_letter';
        const due = status === 'retry_wait' ? now + retryDelay(job.attempt, policy) : job.due_at;
        assertTimestamp(due);
        this.database.prepare(`UPDATE jobs SET status=?,revision=revision+1,fencing_token=fencing_token+1,
          lease_owner=NULL,lease_until=NULL,error_code='lease_expired',due_at=?,updated_at=? WHERE job_id=?`).run(status, due, now, job.job_id);
        this.endAttempt(job, status, 'lease_expired', now);
        this.appendState(job.job_id);
      }
      return expired.length;
    }).immediate();
  }

  public pruneTerminal(epoch: number, before: number): number {
    assertTimestamp(before);
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const rows = this.database.prepare(`SELECT * FROM jobs WHERE status IN ('succeeded','cancelled','dead_letter') AND updated_at<?
        AND NOT EXISTS(SELECT 1 FROM job_outbox WHERE job_outbox.job_id=jobs.job_id AND acknowledged_at IS NULL)`)
        .all(before) as JobRow[];
      for (const row of rows) {
        this.database.prepare('INSERT INTO job_tombstones VALUES(?,?,?,?,?,?)')
          .run(row.job_id, row.scope_id, row.idempotency_key, row.request_digest, row.status, row.revision);
        this.database.prepare('DELETE FROM jobs WHERE job_id=?').run(row.job_id);
        this.database.prepare('DELETE FROM job_outbox WHERE job_id=? AND acknowledged_at IS NOT NULL').run(row.job_id);
      }
      return rows.length;
    }).immediate();
  }

  public close(): void { if (this.database.open) this.database.close(); }

  public registerTrigger(definition: JobTriggerDefinition, epoch: number, now: number): JobTrigger {
    validateTriggerDefinition(definition);
    assertTimestamp(now);
    const document = canonicalJson(definition);
    const digest = createHash('sha256').update(document).digest('hex');
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const current = this.database.prepare('SELECT * FROM job_triggers WHERE trigger_id=?')
        .get(definition.trigger_id) as TriggerRow | undefined;
      if (current) {
        if (current.definition_digest !== digest) throw new JobConflictError('Job trigger definition 冲突');
        return this.decodeTrigger(current);
      }
      const due = definition.schedule === null ? null : initialScheduleDue(definition.schedule);
      this.database.prepare(`INSERT INTO job_triggers(trigger_id,definition_json,definition_digest,revision,enabled,
        next_due_at,last_due_at,created_at,updated_at) VALUES(?,?,?,1,1,?,NULL,?,?)`)
        .run(definition.trigger_id, document, digest, due, now, now);
      return this.loadTrigger(definition.trigger_id)!;
    }).immediate();
  }

  public loadTrigger(triggerId: string): JobTrigger | null {
    const row = this.database.prepare('SELECT * FROM job_triggers WHERE trigger_id=?').get(triggerId) as TriggerRow | undefined;
    return row ? this.decodeTrigger(row) : null;
  }

  public setTriggerEnabled(triggerId: string, epoch: number, expectedRevision: number, enabled: boolean, now: number): JobTrigger | null {
    assertTimestamp(now);
    if (typeof enabled !== 'boolean') throw new Error('Job trigger enabled 无效');
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const changed = this.database.prepare(`UPDATE job_triggers SET enabled=?,revision=revision+1,updated_at=?
        WHERE trigger_id=? AND revision=?`).run(enabled ? 1 : 0, now, triggerId, expectedRevision).changes;
      return changed ? this.loadTrigger(triggerId) : null;
    }).immediate();
  }

  public emitEvent(triggerId: string, event: JobTriggerEvent, epoch: number, now: number): JobSubmission {
    assertTimestamp(now);
    assertTimestamp(event.occurred_at);
    if (!event.event_id?.trim() || event.occurred_at > now) throw new Error('Job event identity/time 无效');
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const trigger = this.loadTrigger(triggerId);
      if (!trigger || trigger.definition.schedule !== null) throw new Error('Job event trigger 不存在或类型错误');
      validateJobRequest({ ...trigger.definition, job_id: triggerId, idempotency_key: event.event_id,
        payload: event.payload, due_at: event.occurred_at });
      return this.materializeOccurrence(trigger, `event:${event.event_id}`, event.occurred_at, event.payload, epoch, now);
    }).immediate();
  }

  public materializeDue(epoch: number, now: number, limit: number): JobSubmission[] {
    assertTimestamp(now);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Job trigger batch limit 无效');
    return this.database.transaction(() => {
      this.assertAuthority(epoch);
      const submissions: JobSubmission[] = [];
      while (submissions.length < limit) {
        const row = this.database.prepare(`SELECT * FROM job_triggers WHERE enabled=1 AND next_due_at<=?
          ORDER BY next_due_at,trigger_id LIMIT 1`).get(now) as TriggerRow | undefined;
        if (!row) break;
        const trigger = this.decodeTrigger(row);
        if (trigger.definition.schedule === null || trigger.next_due_at === null) throw new Error('Job schedule checkpoint 损坏');
        const occurrence = scheduledOccurrence(trigger.definition.schedule, trigger.next_due_at, now);
        submissions.push(this.materializeOccurrence(trigger, `schedule:${occurrence.due_at}`, occurrence.due_at, {}, epoch, now));
        this.database.prepare(`UPDATE job_triggers SET next_due_at=?,last_due_at=?,revision=revision+1,updated_at=? WHERE trigger_id=?`)
          .run(occurrence.next_due_at, occurrence.due_at, now, trigger.definition.trigger_id);
      }
      return submissions;
    }).immediate();
  }

  private materializeOccurrence(trigger: JobTrigger, occurrenceId: string, dueAt: number,
    eventPayload: Readonly<Record<string, unknown>>, epoch: number, now: number): JobSubmission {
    const definition = trigger.definition;
    const digest = createHash('sha256').update(canonicalJson({ due_at: dueAt, payload: eventPayload })).digest('hex');
    const existing = this.database.prepare('SELECT occurrence_digest,job_id FROM job_trigger_occurrences WHERE trigger_id=? AND occurrence_id=?')
      .get(definition.trigger_id, occurrenceId) as OccurrenceRow | undefined;
    if (existing) {
      if (existing.occurrence_digest !== digest) throw new JobConflictError('Job occurrence 内容冲突');
      const job = this.load(existing.job_id);
      const retired = this.database.prepare('SELECT revision FROM job_tombstones WHERE job_id=?')
        .get(existing.job_id) as { revision: number } | undefined;
      if (!job && !retired) throw new Error('Job occurrence 对应的持久身份丢失');
      return { job, job_id: existing.job_id, revision: job?.revision ?? retired!.revision, duplicate: true };
    }
    if (!trigger.enabled) throw new Error('Job trigger 已停用');
    const key = createHash('sha256').update(canonicalJson([definition.scope_id, definition.trigger_id, occurrenceId])).digest('hex');
    const submission = this.enqueue({
      job_id: `job-${key}`, scope_id: definition.scope_id, goal_id: definition.goal_id,
      kind: definition.kind, idempotency_key: `trigger:${key}`,
      payload: { input: definition.payload, occurrence: { occurrence_id: occurrenceId, occurred_at: dueAt, payload: eventPayload } },
      due_at: dueAt, retry_mode: definition.retry_mode, max_attempts: definition.max_attempts,
    }, epoch, now);
    this.database.prepare('INSERT INTO job_trigger_occurrences VALUES(?,?,?,?,?)')
      .run(definition.trigger_id, occurrenceId, digest, submission.job_id, now);
    return submission;
  }

  private decodeTrigger(row: TriggerRow): JobTrigger {
    const { trigger_id: id, definition_json, definition_digest: digest, enabled, ...state } = row;
    return { ...state, definition: JSON.parse(definition_json), enabled: enabled === 1 };
  }

  private endAttempt(job: Pick<Job, 'job_id' | 'attempt'>, status: JobAttempt['status'], error: string | null, now: number): void {
    if (this.database.prepare(`UPDATE job_attempts SET status=?,error_code=?,finished_at=? WHERE job_id=? AND attempt=?`)
      .run(status, error, now, job.job_id, job.attempt).changes !== 1) throw new Error('Job attempt 持久依据丢失');
  }

  private appendState(jobId: string): void {
    const job = this.load(jobId)!;
    const event: JobStateEvent = {
      event_id: createHash('sha256').update(canonicalJson([job.job_id, job.revision])).digest('hex'),
      job_id: job.job_id, scope_id: job.scope_id, goal_id: job.goal_id, kind: job.kind,
      revision: job.revision, status: job.status, attempt: job.attempt, authority_epoch: job.authority_epoch,
      fencing_token: job.fencing_token, result: job.result, error_code: job.error_code, updated_at: job.updated_at,
    };
    this.database.prepare('INSERT INTO job_outbox(event_id,job_id,revision,event_json,created_at) VALUES(?,?,?,?,?)')
      .run(event.event_id, jobId, job.revision, canonicalJson(event), job.updated_at);
  }

  private currentEpoch(): number | null {
    const row = this.database.prepare('SELECT epoch FROM job_authority WHERE singleton=1').get() as { epoch: number } | undefined;
    return row?.epoch ?? null;
  }

  private assertAuthority(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || this.currentEpoch() !== epoch) throw new JobAuthorityError('Job authority 已失效');
  }

  private assertSameRequest(row: Tombstone, request: JobRequest, digest: string): void {
    if (row.scope_id !== request.scope_id || row.idempotency_key !== request.idempotency_key || row.request_digest !== digest) {
      throw new JobConflictError('Job identity payload 冲突');
    }
  }

  private decode(row: JobRow): Job {
    const { payload_json, result_json, request_digest: digest, ...job } = row;
    return { ...job, payload: JSON.parse(payload_json), result: result_json === null ? null : JSON.parse(result_json) };
  }
}
