import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeMetricLabels } from '../../src/foundation/logger/metrics';
import { DeadLetterQueue } from '../../src/foundation/event-bus/dead-letter-queue';
import { DBManager } from '../../src/foundation/storage/db-manager';

describe('observability foundation', () => {
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
        replayCommand: 'python scripts/dlq.py replay kernel:1',
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
