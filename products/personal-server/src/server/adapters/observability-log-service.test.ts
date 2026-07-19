import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObservabilityLogService } from './observability-log-service';

test('lists recent structured observability entries across event, audit and application logs', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'personal-server-observability-'));
  seedLogs(root);
  const service = new ObservabilityLogService(root);

  const entries = await service.listRecentEntries({ limit: 10 });

  assert.equal(entries.length, 3);
  assert.equal(entries[0].source, 'application');
  assert.equal(entries[1].source, 'audit');
  assert.equal(entries[2].source, 'event');
  assert.equal(entries[1].level, 'error');
});

test('filters observability entries by module and trace_id', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'personal-server-observability-'));
  seedLogs(root);
  const service = new ObservabilityLogService(root);

  const byModule = await service.listRecentEntries({ module: 'config' });
  const byTrace = await service.listRecentEntries({ trace_id: 'trace-2' });

  assert.deepEqual(byModule.map((entry) => entry.module), ['config-owner', 'config-owner']);
  assert.deepEqual(byTrace.map((entry) => entry.trace_id), ['trace-2']);
});

test('streams only appended entries after the current cursor', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'personal-server-observability-'));
  seedLogs(root);
  const service = new ObservabilityLogService(root);
  const initial = await service.readIncrementalEntries(service.createCursor(), {});
  const logFile = path.join(root, 'logs', 'application', 'kernel.jsonl');
  writeFileSync(logFile, `${[
    JSON.stringify({
      timestamp: '2026-07-18T17:40:03.000Z',
      level: 'warn',
      module: 'surface-gateway',
      owner: 'kernel',
      runtime_id: 'kernel',
      trace_id: 'trace-3',
      message: 'surface disconnected',
    }),
  ].join('\n')}\n`, { flag: 'a' });

  const appended = await service.readIncrementalEntries(initial.cursor, {});

  assert.equal(initial.entries.length, 3);
  assert.equal(appended.entries.length, 1);
  assert.equal(appended.entries[0].trace_id, 'trace-3');
  assert.equal(appended.entries[0].level, 'warn');
});

function seedLogs(root: string): void {
  const eventPath = path.join(root, 'logs', 'events', 'kernel.jsonl');
  const auditPath = path.join(root, 'logs', 'audit', 'kernel.jsonl');
  const applicationPath = path.join(root, 'logs', 'application', 'kernel.jsonl');
  mkdirSync(path.dirname(eventPath), { recursive: true });
  mkdirSync(path.dirname(auditPath), { recursive: true });
  mkdirSync(path.dirname(applicationPath), { recursive: true });

  writeFileSync(eventPath, `${JSON.stringify({
    timestamp: '2026-07-18T17:40:00.000Z',
    level: 'info',
    event_type: 'config.snapshot',
    event_action: 'read',
    owner: 'configuration',
    module: 'config-owner',
    runtime_id: 'kernel',
    trace_id: 'trace-1',
  })}\n`, { encoding: 'utf8', flag: 'w' });

  writeFileSync(auditPath, `${JSON.stringify({
    timestamp: '2026-07-18T17:40:01.000Z',
    action: 'config.apply',
    target_kind: 'llm_configuration',
    owner: 'configuration',
    module: 'config-owner',
    runtime_id: 'kernel',
    trace_id: 'trace-2',
    outcome: 'failed',
    reason: 'conflict',
  })}\n`, { encoding: 'utf8', flag: 'w' });

  writeFileSync(applicationPath, `${JSON.stringify({
    timestamp: '2026-07-18T17:40:02.000Z',
    level: 'info',
    module: 'kernel-runtime',
    owner: 'kernel',
    runtime_id: 'kernel',
    trace_id: 'trace-3',
    message: 'runtime ready',
  })}\n`, { encoding: 'utf8', flag: 'w' });
}
