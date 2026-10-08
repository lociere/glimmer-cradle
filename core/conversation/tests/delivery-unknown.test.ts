import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { DeliveryController, DeliveryReceiptConflictError, SqliteDeliveryStore, type DeliveryReceiptEnvelope } from '../src/index';

function snapshot(path: string) {
  const database = new Database(path, { readonly: true });
  try {
    const schema = database.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
    return { schema, rows: tables.map(row => [row.name, database.prepare(`SELECT * FROM "${row.name.replaceAll('"', '""')}" ORDER BY rowid`).all()]) };
  } finally { database.close(); }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'glimmer-delivery-facts-')), path = join(root, 'delivery.db');
  const store = new SqliteDeliveryStore(path), clock = { nowIso: () => '2026-01-01T00:00:00Z' };
  const controller = new DeliveryController(store, 'epoch:1', clock);
  const output = controller.begin({ output_id: 'output:one', turn_id: 'turn:one', destination_id: 'surface:one', content_digest: 'digest:one' });
  controller.queue(output.output_id); controller.sent(output.output_id);
  const envelope: DeliveryReceiptEnvelope = { output_id: output.output_id, destination_id: output.destination_id,
    authority_epoch: output.authority_epoch, generation: output.generation, received_at: '2026-01-01T00:01:00Z',
    receipt: { kind: 'delivered', receipt_id: 'receipt:one' } };
  return { root, path, store, clock, controller, output, envelope };
}

describe('Delivery durable receipt facts and retired authority fencing', () => {
  it.each(['range', 'duration', 'reason', 'regression', 'overrun', 'without-receipt'] as const)
  ('Store 直接调用也拒绝 %s 播放事实漂移', fault => {
    const test = fixture();
    try {
      test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'playback_progress', receipt_id: 'progress:prior', heard_through_ms: 50, duration_ms: 100 } });
      const envelope: DeliveryReceiptEnvelope = { ...test.envelope,
        receipt: { kind: 'playback_progress', receipt_id: 'progress:next', heard_through_ms: fault === 'regression' ? 49 : fault === 'overrun' ? 101 : 60 } };
      const transition = { status: 'playing' as const, updated_at: envelope.received_at,
        heard_through_ms: 'heard_through_ms' in envelope.receipt ? envelope.receipt.heard_through_ms : 0,
        duration_ms: 100, receipt: envelope };
      if (fault === 'range') Object.assign(transition, { heard_through_ms: 70 });
      if (fault === 'duration') Object.assign(transition, { duration_ms: 200 });
      if (fault === 'reason') Object.assign(transition, { terminal_reason: 'forged' });
      if (fault === 'without-receipt') Object.assign(transition, { status: 'unknown', receipt: undefined });
      const before = snapshot(test.path);
      expect(() => test.store.transition('output:one', 'epoch:1', 1, new Set(['playing']), transition)).toThrow();
      expect(snapshot(test.path)).toEqual(before);
      expect(test.controller.receipt('progress:next')).toBeNull();
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['unknown-key', 'duplicate-key', 'kind', 'generation', 'destination', 'turn'] as const)
  ('持久 %s 回执损坏不形成确认且查询不写库', fault => {
    const test = fixture();
    try {
      test.controller.applyReceipt(test.envelope);
      const fact = test.controller.receipt('receipt:one')!;
      if (fault === 'unknown-key') Object.assign(fact, { permission: 'granted' });
      else if (fault === 'kind') Object.assign(fact.envelope.receipt, { kind: 'forged' });
      else if (fault === 'generation') Object.assign(fact.envelope, { generation: true });
      else if (fault === 'destination') Object.assign(fact.envelope, { destination_id: 'other' });
      else if (fault === 'turn') Object.assign(fact, { turn_id: 'other' });
      let payload = JSON.stringify(fact);
      if (fault === 'duplicate-key') payload = payload.replace('"turn_id":"turn:one"', '"turn_id":"turn:one","turn_id":"turn:one"');
      const database = new Database(test.path);
      database.prepare('UPDATE delivery_receipt_facts SET payload_json=?').run(payload);
      database.close();
      const before = snapshot(test.path);
      expect(() => test.controller.receipt('receipt:one')).toThrow(DeliveryReceiptConflictError);
      // Unknown kind 不匹配确认查询；其余已知成功 kind 必须核验完整绑定而不是只看 kind。
      if (fault === 'kind') expect(test.controller.confirmedReceipt('output:one')).toBeNull();
      else expect(() => test.controller.confirmedReceipt('output:one')).toThrow(DeliveryReceiptConflictError);
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('同 epoch supersession 保留历史确认但拒绝新迟到回执，精确重投不改库', () => {
    const test = fixture();
    try {
      test.controller.applyReceipt(test.envelope);
      const fact = test.controller.confirmedReceipt('output:one');
      test.controller.begin({ output_id: 'output:next', turn_id: 'turn:next', destination_id: 'surface:one', content_digest: 'digest:next' });
      const before = snapshot(test.path);
      expect(test.controller.current('output:one')?.status).toBe('interrupted');
      expect(test.controller.confirmedReceipt('output:one')).toEqual(fact);
      expect(test.controller.applyReceipt({ ...test.envelope, received_at: '2026-01-01T00:02:00Z' })).toEqual({ accepted: true, reason: 'duplicate' });
      expect(test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'delivered', receipt_id: 'receipt:late' } })).toEqual({ accepted: false, reason: 'stale_generation' });
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['sent', 'unknown'] as const)('旧 owner 的 %s 幂等捷径不报告成功', status => {
    const test = fixture(), second = new SqliteDeliveryStore(test.path);
    try {
      if (status === 'unknown') test.controller.unknown('output:one', 'ambiguous');
      new DeliveryController(second, 'epoch:2', test.clock);
      const before = snapshot(test.path);
      expect(() => status === 'sent' ? test.controller.sent('output:one') : test.controller.unknown('output:one', 'late')).toThrow(/epoch/u);
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); second.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('旧库首次激活失败回滚整个新 authority 窗口，重试才建立可信 owner', () => {
    const test = fixture();
    test.store.close();
    let reopened: SqliteDeliveryStore | undefined;
    try {
      const database = new Database(test.path);
      database.exec('DROP TABLE delivery_retired_authorities; DROP TABLE delivery_authority_meta;');
      database.exec("CREATE TRIGGER fixture_fault BEFORE UPDATE ON delivery_outputs BEGIN SELECT RAISE(ABORT,'authority failure'); END");
      database.close();
      reopened = new SqliteDeliveryStore(test.path);
      const before = snapshot(test.path);
      expect(() => new DeliveryController(reopened!, 'epoch:2', test.clock)).toThrow(/authority failure/u);
      expect(snapshot(test.path)).toEqual(before);
      const repair = new Database(test.path); repair.exec('DROP TRIGGER fixture_fault'); repair.close();
      new DeliveryController(reopened, 'epoch:2', test.clock);
      expect(reopened.load('output:one')?.status).toBe('interrupted');
      expect(() => new DeliveryController(reopened!, 'epoch:1', test.clock)).toThrow(/authority/u);
      expect(reopened.confirmedReceipt('output:one')).toBeNull();
    } finally { reopened?.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['delivered', 'playback_started', 'playback_progress', 'playback_completed', 'failed', 'unknown'] as const)
  ('实际 %s 回执原子保存完整绑定，重启和晚到重复不重写首次事实', kind => {
    const test = fixture();
    let store = test.store;
    try {
      const receipt = kind === 'playback_progress' || kind === 'playback_completed'
        ? { kind, receipt_id: 'receipt:one', heard_through_ms: 50, duration_ms: 100 }
        : kind === 'failed' || kind === 'unknown' ? { kind, receipt_id: 'receipt:one', reason: '实际接收结果' }
          : { kind, receipt_id: 'receipt:one' };
      const envelope = { ...test.envelope, receipt } as DeliveryReceiptEnvelope;
      if (kind === 'playback_completed') {
        test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'playback_started', receipt_id: 'receipt:started' } });
      }
      expect(test.controller.applyReceipt(envelope)).toEqual({ accepted: true });
      const fact = { envelope: structuredClone(envelope), turn_id: 'turn:one', content_digest: 'digest:one' };
      expect(test.controller.receipt('receipt:one')).toEqual(fact);
      expect(test.controller.confirmedReceipt('output:one')).toEqual(kind === 'delivered' || kind === 'playback_completed' ? fact : null);
      store.close(); store = new SqliteDeliveryStore(test.path);
      const controller = new DeliveryController(store, 'epoch:1', test.clock);
      const before = snapshot(test.path);
      expect(controller.receipt('receipt:one')).toEqual(fact);
      expect(controller.applyReceipt({ ...envelope, received_at: '2026-01-01T00:02:00Z' })).toEqual({ accepted: true, reason: 'duplicate' });
      expect(snapshot(test.path)).toEqual(before);
      expect(controller.receipt('receipt:one')).toEqual(fact);
    } finally { store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['output', 'destination', 'epoch', 'generation', 'kind', 'progress', 'duration'] as const)
  ('同 receipt ID 的 %s 变化不得冒充 duplicate', fault => {
    const test = fixture();
    try {
      const original: DeliveryReceiptEnvelope = { ...test.envelope,
        receipt: { kind: 'playback_progress', receipt_id: 'receipt:one', heard_through_ms: 10, duration_ms: 100 } };
      expect(test.controller.applyReceipt(original)).toEqual({ accepted: true });
      const changed = structuredClone(original);
      if (fault === 'output') Object.assign(changed, { output_id: 'other' });
      else if (fault === 'destination') Object.assign(changed, { destination_id: 'other' });
      else if (fault === 'epoch') Object.assign(changed, { authority_epoch: 'other' });
      else if (fault === 'generation') Object.assign(changed, { generation: 2 });
      else if (fault === 'kind') Object.assign(changed.receipt, { kind: 'playback_completed' });
      else if (fault === 'progress') Object.assign(changed.receipt, { heard_through_ms: 20 });
      else Object.assign(changed.receipt, { duration_ms: 200 });
      const before = snapshot(test.path);
      expect(test.controller.applyReceipt(changed)).toEqual({ accepted: false,
        reason: fault === 'epoch' ? 'stale_generation' : 'receipt_conflict' });
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['kind', 'field', 'boolean', 'time', 'budget', 'reason'] as const)
  ('非法 %s 在去重前拒绝，不污染持久状态', fault => {
    const test = fixture();
    try {
      test.controller.applyReceipt(test.envelope);
      const changed = structuredClone(test.envelope);
      if (fault === 'kind') Object.assign(changed.receipt, { kind: 'forged' });
      else if (fault === 'field') Object.assign(changed, { permission: 'granted' });
      else if (fault === 'boolean') Object.assign(changed, { generation: true });
      else if (fault === 'time') Object.assign(changed, { received_at: 'invalid' });
      else if (fault === 'budget') Object.assign(changed, { destination_id: 'x'.repeat(4097) });
      else Object.assign(changed, { receipt: { kind: 'failed', receipt_id: 'receipt:one', reason: ' ' } });
      const before = snapshot(test.path);
      expect(() => test.controller.applyReceipt(changed)).toThrow();
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('两个真实连接切主后旧 controller 的新目的地/中断/重复/历史查询均不能夺回 epoch', () => {
    const test = fixture(), second = new SqliteDeliveryStore(test.path);
    try {
      test.controller.applyReceipt(test.envelope);
      const fact = test.controller.receipt('receipt:one');
      const current = new DeliveryController(second, 'epoch:2', test.clock);
      const before = snapshot(test.path);
      expect(() => test.controller.begin({ output_id: 'old:new', turn_id: 'old:turn', destination_id: 'new:destination', content_digest: 'old:digest' })).toThrow(/epoch/u);
      expect(() => test.controller.interrupt('surface:one', 'late')).toThrow(/epoch/u);
      expect(() => new DeliveryController(test.store, 'epoch:1', test.clock)).toThrow(/authority/u);
      expect(test.controller.applyReceipt(test.envelope)).toEqual({ accepted: false, reason: 'stale_generation' });
      expect(current.applyReceipt(test.envelope)).toEqual({ accepted: false, reason: 'stale_generation' });
      expect(() => test.controller.receipt('receipt:one')).toThrow(/epoch/u);
      expect(test.controller.current('output:one')).toBeNull();
      expect(test.controller.recover()).toEqual([]);
      expect(current.confirmedReceipt('output:one')).toEqual(fact);
      expect(snapshot(test.path)).toEqual(before);
      const output = current.begin({ output_id: 'new:one', turn_id: 'new:turn', destination_id: 'surface:one', content_digest: 'new:digest' });
      expect(output.generation).toBe(1);
      second.close();
      const reopened = new SqliteDeliveryStore(test.path);
      try {
        expect(() => new DeliveryController(reopened, 'epoch:1', test.clock)).toThrow(/authority/u);
        const recovered = new DeliveryController(reopened, 'epoch:2', test.clock);
        expect(recovered.confirmedReceipt('output:one')).toEqual(fact);
      } finally { reopened.close(); }
    } finally { test.store.close(); second.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('Store 同事务拒绝跨 output receipt 与无信封外部成功转换', () => {
    const test = fixture();
    try {
      test.controller.applyReceipt(test.envelope);
      const output = test.controller.begin({ output_id: 'output:two', turn_id: 'turn:two', destination_id: 'surface:two', content_digest: 'digest:two' });
      test.controller.queue(output.output_id); test.controller.sent(output.output_id);
      const before = snapshot(test.path);
      expect(() => test.store.transition(output.output_id, output.authority_epoch, output.generation, new Set(['sent']),
        { status: 'delivered', updated_at: test.envelope.received_at })).toThrow(DeliveryReceiptConflictError);
      const foreign = { ...test.envelope, output_id: output.output_id, destination_id: output.destination_id, generation: output.generation };
      expect(() => test.store.transition(output.output_id, output.authority_epoch, output.generation, new Set(['sent']),
        { status: 'delivered', updated_at: foreign.received_at, receipt: foreign })).toThrow(DeliveryReceiptConflictError);
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['first-window', 'receipt', 'fact', 'output'] as const)('实际 %s 写入失败全事务回滚，不留下孤立成功或回执', fault => {
    const test = fixture();
    try {
      if (fault !== 'first-window') {
        test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'unknown', receipt_id: 'receipt:prior', reason: 'unknown' } });
      }
      const database = new Database(test.path);
      const table = fault === 'receipt' ? 'delivery_receipts' : fault === 'fact' ? 'delivery_receipt_facts' : 'delivery_outputs';
      database.exec(`CREATE TRIGGER fixture_fault BEFORE ${table === 'delivery_outputs' ? 'UPDATE' : 'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'fixture failure'); END`);
      database.close();
      const before = snapshot(test.path);
      expect(() => test.controller.applyReceipt(test.envelope)).toThrow(/fixture failure/u);
      expect(snapshot(test.path)).toEqual(before);
      expect(test.controller.confirmedReceipt('output:one')).toBeNull();
      expect(test.controller.receipt('receipt:one')).toBeNull();
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('切主元数据失败同时回滚 retirement 和所有 active 输出', () => {
    const test = fixture();
    try {
      const database = new Database(test.path);
      database.exec("CREATE TRIGGER fixture_fault BEFORE UPDATE ON delivery_authority_meta BEGIN SELECT RAISE(ABORT,'authority failure'); END");
      database.close();
      const before = snapshot(test.path);
      expect(() => new DeliveryController(test.store, 'epoch:2', test.clock)).toThrow(/authority failure/u);
      expect(snapshot(test.path)).toEqual(before);
      expect(test.store.isCurrentEpoch('epoch:1')).toBe(true);
      expect(test.controller.applyReceipt(test.envelope)).toEqual({ accepted: true });
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('旧最小 receipt 不补造完整确认，独立真实新回执才可恢复送达事实', () => {
    const test = fixture();
    try {
      const database = new Database(test.path);
      database.prepare('INSERT INTO delivery_receipts VALUES(?,?,?)').run('receipt:legacy', 'output:one', test.envelope.received_at);
      database.prepare("UPDATE delivery_outputs SET status='delivered' WHERE output_id=?").run('output:one');
      database.close();
      const before = snapshot(test.path);
      expect(() => test.controller.receipt('receipt:legacy')).toThrow(DeliveryReceiptConflictError);
      expect(test.controller.confirmedReceipt('output:one')).toBeNull();
      expect(test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'delivered', receipt_id: 'receipt:legacy' } }))
        .toEqual({ accepted: false, reason: 'receipt_conflict' });
      expect(snapshot(test.path)).toEqual(before);
      expect(test.controller.applyReceipt(test.envelope)).toEqual({ accepted: true });
      expect(test.controller.confirmedReceipt('output:one')?.envelope.receipt.receipt_id).toBe('receipt:one');
      expect(() => test.controller.receipt('receipt:legacy')).toThrow(DeliveryReceiptConflictError);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it('省略 duration 的播放回执仍受原实际时长约束', () => {
    const test = fixture();
    try {
      test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'playback_progress', receipt_id: 'progress:one', heard_through_ms: 50, duration_ms: 100 } });
      const before = snapshot(test.path);
      expect(() => test.controller.applyReceipt({ ...test.envelope, receipt: { kind: 'playback_progress', receipt_id: 'progress:two', heard_through_ms: 101 } }))
        .toThrow(/时长/u);
      expect(snapshot(test.path)).toEqual(before);
    } finally { test.store.close(); rmSync(test.root, { recursive: true, force: true }); }
  });

  it.each(['authority-version', 'receipt-version', 'partial', 'missing-parent', 'corrupt-fact', 'binding', 'metadata-column', 'base-column'] as const)
  ('%s 损坏不自动修复或宣称确认', fault => {
    const test = fixture();
    test.controller.applyReceipt(test.envelope);
    test.store.close();
    try {
      const database = new Database(test.path);
      if (fault === 'authority-version') database.exec("UPDATE delivery_authority_meta SET value='99' WHERE key='schema_version'");
      else if (fault === 'receipt-version') database.exec("UPDATE delivery_receipt_meta SET value='99'");
      else if (fault === 'partial') database.exec('DROP TABLE delivery_receipt_meta');
      else if (fault === 'missing-parent') database.exec('DROP TABLE delivery_retired_authorities; DROP TABLE delivery_authority_meta;');
      else if (fault === 'metadata-column') database.exec('ALTER TABLE delivery_authority_meta RENAME COLUMN value TO wrong');
      else if (fault === 'base-column') database.exec('ALTER TABLE delivery_outputs RENAME COLUMN turn_id TO wrong');
      else if (fault === 'binding') database.exec("UPDATE delivery_outputs SET content_digest='forged'");
      else database.exec("UPDATE delivery_receipt_facts SET payload_json='null'");
      database.close();
      const before = snapshot(test.path);
      if (fault === 'binding' || fault === 'corrupt-fact') {
        const store = new SqliteDeliveryStore(test.path);
        try { expect(() => store.receipt('receipt:one')).toThrow(DeliveryReceiptConflictError); }
        finally { store.close(); }
      } else expect(() => new SqliteDeliveryStore(test.path)).toThrow();
      expect(snapshot(test.path)).toEqual(before);
    } finally { rmSync(test.root, { recursive: true, force: true }); }
  });
});

describe('Delivery unknown reconciliation', () => {
  it('固定 playout fixture 保持 epoch、generation 与 heard range 单调', () => {
    const events = JSON.parse(readFileSync(
      join(__dirname, 'fixtures', 'playout-events.json'), 'utf8',
    )) as Array<{ authority_epoch: number; generation: number; heard_through: number }>;
    expect(new Set(events.map((event) => event.authority_epoch))).toEqual(new Set([7]));
    expect(new Set(events.map((event) => event.generation))).toEqual(new Set([3]));
    expect(events.map((event) => event.heard_through)).toEqual([0, 12, 12]);
  });

  it('keeps an ambiguous send unknown across restart until an authoritative receipt arrives', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-delivery-unknown-'));
    const databasePath = join(root, 'delivery.db');
    const clock = { nowIso: () => '2026-01-01T00:00:00Z' };
    let store: SqliteDeliveryStore | undefined;
    try {
      store = new SqliteDeliveryStore(databasePath);
      let controller = new DeliveryController(store, 'epoch:stable', clock);
      const output = controller.begin({
        output_id: 'output:unknown',
        turn_id: 'turn:unknown',
        destination_id: 'surface:remote',
        content_digest: 'sha256:unknown',
      });
      controller.queue(output.output_id);
      controller.unknown(output.output_id, 'socket_closed_after_write');
      store.close();

      store = new SqliteDeliveryStore(databasePath);
      controller = new DeliveryController(store, 'epoch:stable', clock);
      expect(controller.recover()).toEqual([
        expect.objectContaining({
          output_id: output.output_id,
          status: 'unknown',
          terminal_reason: 'socket_closed_after_write',
        }),
      ]);
      expect(controller.applyReceipt({
        output_id: output.output_id,
        destination_id: output.destination_id,
        authority_epoch: output.authority_epoch,
        generation: output.generation,
        received_at: '2026-01-01T00:01:00Z',
        receipt: { kind: 'delivered', receipt_id: 'receipt:reconciled' },
      })).toEqual({ accepted: true });
      expect(store.load(output.output_id)?.status).toBe('delivered');
    } finally {
      store?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed receipt metadata before it can contaminate durable delivery state', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-delivery-validation-'));
    const store = new SqliteDeliveryStore(join(root, 'delivery.db'));
    try {
      const controller = new DeliveryController(store, 'epoch:stable');
      const output = controller.begin({
        output_id: 'output:validation',
        turn_id: 'turn:validation',
        destination_id: 'surface:validation',
        content_digest: 'sha256:validation',
      });
      controller.queue(output.output_id);
      controller.sent(output.output_id);
      expect(() => controller.applyReceipt({
        output_id: output.output_id,
        destination_id: output.destination_id,
        authority_epoch: output.authority_epoch,
        generation: output.generation,
        received_at: 'not-a-time',
        receipt: { kind: 'delivered', receipt_id: 'receipt:invalid-time' },
      })).toThrow(/received_at/u);
      expect(store.load(output.output_id)?.status).toBe('sent');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
