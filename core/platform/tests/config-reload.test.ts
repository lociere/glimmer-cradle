import type {} from 'node:test';
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { test } = require('node:test') as typeof import('node:test');
const { ConfigurationValidator, loadConfiguration, configurationRevision } = require('@glimmer-cradle/platform') as typeof import('../src/index');
const { readFileSync } = require('node:fs') as typeof import('node:fs');
const { join } = require('node:path') as typeof import('node:path');

const schema = {
  $id: 'https://example.test/config',
  type: 'object',
  additionalProperties: false,
  properties: {
    count: { type: 'integer', default: 3 },
    endpoint: { type: 'string', format: 'uri' },
  },
};

test('the authoritative lifecycle Schema rejects unsupported timer budgets before App resource construction', () => {
  const lifecycle = JSON.parse(readFileSync(join(__dirname, '../../../contracts/json-schema/config/v1/lifecycle-config.schema.json'), 'utf8'));
  const validator = new ConfigurationValidator({ lifecycle });
  const defaults: Record<string, unknown> = {};
  assert.equal(validator.validate('lifecycle', defaults).ok, true);
  assert.equal(defaults.start_timeout_ms, 30000); assert.equal(defaults.stop_timeout_ms, 30000);
  for (const key of ['start_timeout_ms', 'stop_timeout_ms']) {
    assert.equal(validator.validate('lifecycle', { [key]: 2147483647 }).ok, true);
    const rejected = validator.validate('lifecycle', { [key]: 2147483648 });
    assert.equal(rejected.ok, false);
    assert.deepEqual(rejected.errors, [`/${key}: must be <= 2147483647`]);
    assert.equal(validator.validate('lifecycle', { [key]: 999 }).ok, false);
  }
});

test('fills defaults in place, rejects rather than strips unknown fields, and does not coerce', () => {
  const validator = new ConfigurationValidator({ config: schema }, { formats: true });
  const input = {};
  const result = validator.validate('config', input);
  assert.equal(result.data, input);
  assert.deepEqual(input, { count: 3 });
  const invalid = { unexpected: true, count: '3', endpoint: 'invalid uri' };
  const rejected = validator.validate('config', invalid);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.data, undefined);
  assert.deepEqual(rejected.errors, [
    '/: must NOT have additional properties',
    '/count: must be integer',
    '/endpoint: must match format "uri"',
  ]);
  assert.equal(invalid.unexpected, true);
  // 连续调用复用编译结果，但不能泄露上一份输入的错误。
  assert.deepEqual(validator.validate('config', {}), { ok: true, data: { count: 3 }, errors: [] });
});

test('registers the whole injected schema set before compiling cross-schema references', () => {
  const validator = new ConfigurationValidator({
    root: { type: 'object', properties: { child: { $ref: 'https://example.test/child' } } },
    child: { $id: 'https://example.test/child', type: 'integer', minimum: 1 },
  });
  assert.equal(validator.validate('root', { child: 1 }).ok, true);
  assert.deepEqual(validator.validate('root', { child: 0 }).errors, ['/child: must be >= 1']);
});

test('schema ids and caches are isolated across owner instances', () => {
  const a = new ConfigurationValidator({ config: { $id: 'https://example.test/shared', type: 'string' } });
  const b = new ConfigurationValidator({ config: { $id: 'https://example.test/shared', type: 'number' } });
  assert.equal(a.validate('config', 'value').ok, true);
  assert.equal(b.validate('config', 'value').ok, false);
  assert.equal(b.validate('config', 1).ok, true);
});

test('formats are installed only for consumers that opt in', () => {
  const validator = new ConfigurationValidator({ config: {
    type: 'string', format: 'date',
  } });
  assert.equal(validator.validate('config', 'invalid').ok, true);
  const withFormats = new ConfigurationValidator({ config: {
    type: 'string', format: 'date',
  } }, { formats: true });
  assert.equal(withFormats.validate('config', 'invalid').ok, false);
});

test('loads independent immutable documents with defaults; a rejected reload cannot mutate the prior snapshot', () => {
  const validator = new ConfigurationValidator({ config: {
    type: 'object', additionalProperties: false,
    properties: { nested: { type: 'object', default: {}, properties: { count: { type: 'integer', minimum: 1, default: 3 } } } },
  } });
  const options = { schema: 'config' as const, validator, parse: JSON.parse, maxBytes: 1024 };
  const load = (text: string) => loadConfiguration<{ nested: { count: number } }, 'config'>(Buffer.from(text), options);
  const previous = load('{}');
  assert.deepEqual(previous, { nested: { count: 3 } });
  assert.equal(Object.isFrozen(previous.nested), true);
  assert.equal(Reflect.set(previous.nested, 'count', 99), false);
  assert.throws(() => load('{"nested":{"count":0}}'), /配置读取或校验失败/);
  const next = load('{"nested":{"count":7}}');
  assert.notEqual(previous, next);
  assert.deepEqual(previous, { nested: { count: 3 } });
  assert.deepEqual(next, { nested: { count: 7 } });
});

test('rejects oversized bytes, malformed UTF-8 and BOM before parser invocation, including multibyte boundaries', () => {
  let parsed = 0;
  const options = { schema: 'config' as const, validator: new ConfigurationValidator({ config: { type: 'object' } }),
    maxBytes: 2, parse: (_text: string) => { parsed += 1; return {}; } };
  for (const bytes of [Buffer.from('界'), Buffer.from([0xff]), Buffer.from([0xe7, 0x95]), Buffer.from('\uFEFF{}')]) {
    assert.throws(() => loadConfiguration(bytes, options), /配置读取或校验失败/);
  }
  assert.equal(parsed, 0);
  assert.deepEqual(loadConfiguration(Buffer.from('{}'), options), {});
  assert.equal(parsed, 1);
  assert.throws(() => loadConfiguration(Buffer.from('{}'), { ...options, maxBytes: NaN }), /配置读取或校验失败/);
  // BOM 必须独立于大小上限拒绝。
  assert.throws(() => loadConfiguration(Buffer.from('\uFEFF{}'), { ...options, maxBytes: 1024 }), /配置读取或校验失败/);
  assert.equal(parsed, 1);
});

test('parser and Schema failures do not disclose configuration values or publish partial defaults', () => {
  const validator = new ConfigurationValidator({ config: schema });
  const options = { schema: 'config' as const, validator, maxBytes: 1024, parse: JSON.parse };
  for (const parse of [JSON.parse, () => { throw new Error('fixture-private-secret'); }]) {
    assert.throws(() => loadConfiguration(Buffer.from('fixture-private-secret'), { ...options, parse }),
      (error: unknown) => error instanceof Error && error.message === '配置读取或校验失败');
  }
  assert.throws(() => loadConfiguration(Buffer.from('{"count":"fixture-private-secret"}'), options),
    (error: unknown) => error instanceof Error && error.message === '配置读取或校验失败');
  assert.deepEqual(loadConfiguration(Buffer.from('{}'), options), { count: 3 });
});

test('configuration revisions preserve the existing ordered JSON UTF-8 bytes and distinguish document boundaries', () => {
  const documents = [{ route: '模型', enabled: true }, { providers: { fixture: 'secret' } }, { x: [1, null] }];
  assert.equal(configurationRevision(documents), '43f966f0e7fcfef397f8bd3795ebebda8e02c1d4df7f8d8c2f74beeb2320ebc8');
  assert.notEqual(configurationRevision(documents), configurationRevision([...documents].reverse()));
  assert.notEqual(configurationRevision(['ab', 'c']), configurationRevision(['a', 'bc']));
  assert.notEqual(configurationRevision([{ a: 1, b: 2 }]), configurationRevision([{ b: 2, a: 1 }]));
  assert.throws(() => configurationRevision([undefined]), /不能序列化/);
});
