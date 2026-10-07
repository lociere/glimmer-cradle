import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeMetricLabels } from '../../src/adapters/observability/metrics';
import { DeadLetterQueue } from '../../src/adapters/events/dead-letter-queue';
import { DBManager } from '../../src/adapters/storage/db-manager';
import * as plane from '../../src/adapters/observability/plane/plane';
import { SkillInvocationDiagnosticsAdapter } from '../../src/adapters/observability/skill-invocation-diagnostics-adapter';

describe('observability foundation', () => {
  it('Execution unknown 投影为独立事件与恢复提示，而不是可重试 failed', () => {
    const event = vi.spyOn(plane, 'recordObservabilityEvent').mockImplementation(() => undefined as never);
    const audit = vi.spyOn(plane, 'appendAuditRecord').mockImplementation(() => undefined as never);
    new SkillInvocationDiagnosticsAdapter().record({ timestamp: '2026-10-07T00:00:00Z', trace_id: 'trace',
      provider_kind: 'core', provider_id: 'receiver', skill_id: 'test.tool', target_kind: 'tool', target_name: 'run',
      status: 'unknown', duration_ms: 1, error_message: 'execution_recovery_required', confirmation_required: false },
    { audit: true, riskLevel: 'low' });
    expect(event).toHaveBeenCalledWith('skill.invocation.unknown', expect.objectContaining({
      event_outcome: 'partial', error_kind: 'execution_recovery_required', attributes: expect.objectContaining({ execution_state: 'unknown' }),
    }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'skill.tool.unknown', outcome: 'partial' }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('metrics 只保留白名单 labels', () => {
    expect(sanitizeMetricLabels('skill.invocation.count', {
      provider_id: 'core',
      skill_id: 'core.notification',
      address_mode: 'direct',
      response_policy: 'reply_allowed',
      attention_projection_mode: 'foreground',
      status: 'succeeded',
      trace_id: 'should-drop',
      prompt_hash: 'should-drop',
    })).toEqual({
      provider_id: 'core',
      skill_id: 'core.notification',
      address_mode: 'direct',
      response_policy: 'reply_allowed',
      attention_projection_mode: 'foreground',
      status: 'succeeded',
    });
  });

  it('DLQ 以恢复队列字段落盘并支持重放状态', () => {
    const db = new Database(':memory:');
    vi.spyOn(DBManager.instance, 'getDB').mockReturnValue(db as never);
    (DeadLetterQueue as any)._instance = null;

    const queue = DeadLetterQueue.instance;
    queue.init();
    queue.enqueue(
      'trace-dlq-1',
      'skill.invocation.failed',
      { skill_id: 'test.skill', prompt: 'secret prompt' },
      new Error('boom'),
      {
        owner: 'skill_plane',
        failurePhase: 'execute',
        errorCode: 'SKILL_EXECUTION_FAILED',
        sourcePath: 'core/kernel/tests',
        redactedPayloadSummary: '{"skill_id":"test.skill"}',
        retryPolicy: 'manual',
        replayCommand: 'python core/kernel/tools/dlq.py replay kernel:1 --confirm --dispatcher <registered-id>',
        diagnosticHint: '检查 skill handler',
      },
    );

    const rows = queue.queryByTrace('trace-dlq-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trace_id: 'trace-dlq-1',
      event_type: 'skill.invocation.failed',
      failure_phase: 'execute',
      error_code: 'SKILL_EXECUTION_FAILED',
      owner: 'skill_plane',
      status: 'pending',
      redacted_payload_summary: '{"skill_id":"test.skill"}',
      retry_policy: 'manual',
    });

    queue.markReplayed(rows[0].id);
    const replayed = queue.queryByTrace('trace-dlq-1')[0];
    expect(replayed.status).toBe('replayed');
    expect(replayed.replayed).toBeTruthy();

    db.close();
  });
});
