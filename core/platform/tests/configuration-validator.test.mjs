import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigurationValidator } from '@glimmer-cradle/platform/configuration';
import { readFileSync } from 'node:fs';

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
  const lifecycle = JSON.parse(readFileSync(new URL('../../../contracts/json-schema/config/v1/lifecycle-config.schema.json', import.meta.url), 'utf8'));
  const validator = new ConfigurationValidator({ lifecycle });
  const defaults = {};
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
