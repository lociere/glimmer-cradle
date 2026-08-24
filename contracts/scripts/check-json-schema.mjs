import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a path`);
  return resolve(value);
}

const root = option('--contracts-root', resolve(import.meta.dirname, '..'));
const schemaRoot = resolve(root, 'json-schema');
const baselinePath = resolve(root, 'compatibility/json-schema-baseline.json');
const validFixture = resolve(root, 'fixtures/skill-tool-parameters.valid.json');
const invalidFixture = resolve(root, 'fixtures/skill-tool-parameters.invalid.json');

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const schemas = walk(schemaRoot).filter((file) => file.endsWith('.schema.json'));
if (schemas.length === 0) {
  throw new Error('contracts/json-schema does not contain any *.schema.json files');
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
for (const keyword of ['x-glimmer-owner', 'x-glimmer-contract-kind', 'x-glimmer-compatibility']) {
  ajv.addKeyword(keyword);
}
const seenIds = new Set();
const current = new Map();
const compiled = new Map();
const documents = [];

for (const file of schemas) {
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  const path = relative(root, file).replaceAll('\\', '/');
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    throw new Error(`${path} must use JSON Schema draft 2020-12`);
  }
  for (const key of ['$id', 'x-glimmer-owner', 'x-glimmer-contract-kind', 'x-glimmer-compatibility']) {
    if (!schema[key]) throw new Error(`${path} is missing ${key}`);
  }
  if (schema['x-glimmer-contract-kind'] !== 'Document') {
    throw new Error(`${path} must remain a Document contract in Slice 1`);
  }
  if (seenIds.has(schema.$id)) throw new Error(`duplicate JSON Schema $id: ${schema.$id}`);
  seenIds.add(schema.$id);
  documents.push({ path, schema });
  current.set(path, {
    path,
    id: schema.$id,
    dialect: schema.$schema,
    owner: schema['x-glimmer-owner'],
    kind: schema['x-glimmer-contract-kind'],
    compatibility: schema['x-glimmer-compatibility'],
    sha256: sha256(file),
  });
}

for (const { schema } of documents) ajv.addSchema(schema);
for (const { path, schema } of documents) compiled.set(path, ajv.getSchema(schema.$id));

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
if (!Array.isArray(baseline.schemas)) {
  throw new Error('JSON Schema compatibility baseline must contain a schemas array');
}

const baselinePaths = new Set();
const baselineIds = new Set();
for (const expected of baseline.schemas) {
  if (!expected.path || !expected.id) {
    throw new Error('JSON Schema compatibility baseline entries require path and id');
  }
  if (baselinePaths.has(expected.path)) {
    throw new Error(`duplicate JSON Schema compatibility baseline path: ${expected.path}`);
  }
  if (baselineIds.has(expected.id)) {
    throw new Error(`duplicate JSON Schema compatibility baseline $id: ${expected.id}`);
  }
  baselinePaths.add(expected.path);
  baselineIds.add(expected.id);

  const actual = current.get(expected.path);
  if (!actual) throw new Error(`JSON Schema compatibility baseline lost ${expected.path}`);
  for (const key of ['id', 'dialect', 'owner', 'kind', 'compatibility', 'sha256']) {
    if (actual[key] !== expected[key]) {
      throw new Error(`JSON Schema compatibility baseline mismatch for ${expected.path}: ${key}`);
    }
  }
}

for (const [path, actual] of current) {
  if (!baselinePaths.has(path)) {
    throw new Error(`JSON Schema is not registered in compatibility baseline: ${path}`);
  }
  if (!baselineIds.has(actual.id)) {
    throw new Error(`JSON Schema $id is not registered in compatibility baseline: ${actual.id}`);
  }
}

if (current.size !== baseline.schemas.length) {
  throw new Error(`JSON Schema compatibility set size mismatch: current=${current.size}, baseline=${baseline.schemas.length}`);
}

const validate = compiled.get('json-schema/skill/v1/tool-parameters.schema.json');
if (!validate) {
  throw new Error('missing compiled tool parameters schema');
}
if (!validate(JSON.parse(readFileSync(validFixture, 'utf8')))) {
  throw new Error(`valid fixture failed validation: ${ajv.errorsText(validate.errors)}`);
}
if (validate(JSON.parse(readFileSync(invalidFixture, 'utf8')))) {
  throw new Error('invalid fixture unexpectedly passed validation');
}

console.log('contracts json-schema: ok');
