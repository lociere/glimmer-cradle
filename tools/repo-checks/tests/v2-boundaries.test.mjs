import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyV2Exceptions, collectV2Violations, findImportCycles, readSourceImports } from '../src/architecture/v2-boundaries.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
  return root;
}

test('imports include export, type, dynamic import and require; comments are excluded', () => {
  const result = readSourceImports('a.ts', `// import 'OpenAI';\nexport { A } from './a';\nimport type { B } from './b';\ntype C = import('./c').C;\nconst d = require('./d');\nimport('./e');`);
  assert.deepEqual(result.imports.map(i => i.value), ['./a', './b', './c', './d', './e']);
  assert.deepEqual(result.vendors, []);
});

test('reject reverse dependencies, SDK coupling, internal imports and vendor domain names', t => {
  const root = fixture(t, {
    'core/platform/src/index.ts': `import { C } from '../../cognition/src/internal';\nimport { X } from '@glimmer-cradle/extension-sdk';\nexport interface OpenAIFile { id: string }`,
    'core/cognition/src/internal.ts': 'export class C {}',
    'templates/example/src/index.ts': `export * from '../../../core/cognition/src/internal';`,
  });
  const findings = collectV2Violations(root);
  for (const rule of ['dependency-direction', 'core-sdk', 'deep-import', 'vendor-core', 'extension-internal']) {
    assert.ok(findings.some(item => item.rule === rule), rule);
  }
});

test('allow public cross-module entrypoints and provider implementations outside Core', t => {
  const root = fixture(t, {
    'core/cognition/src/index.ts': `import { Text } from '../../content/src/index';`,
    'core/content/src/index.ts': 'export interface Text { text: string }',
    'apps/cognition-worker/providers/openai.ts': 'export class OpenAIProvider {}',
    'core/content/tests/fixture.ts': 'export class DiscordAttachment {}',
  });
  assert.deepEqual(collectV2Violations(root), []);
});

test('allows Python package-internal imports in app composition', t => {
  const root = fixture(t, {
    'apps/cognition-worker/src/glimmer_cradle/cognition_worker/__init__.py':
      'from glimmer_cradle.cognition_worker.composition import compose\n',
    'apps/cognition-worker/src/glimmer_cradle/cognition_worker/composition.py':
      'def compose(): return None\n',
  });
  assert.deepEqual(collectV2Violations(root), []);
});

test('allows Python cross-package imports through explicit package entrypoints', t => {
  const root = fixture(t, {
    'apps/cognition-worker/src/glimmer_cradle/cognition_worker/composition.py':
      'from glimmer_cradle.cognition.ports import CapabilityPort\n',
    'core/cognition/src/glimmer_cradle/cognition/__init__.py': '',
    'core/cognition/src/glimmer_cradle/cognition/ports/__init__.py': 'class CapabilityPort: pass\n',
  });
  assert.deepEqual(collectV2Violations(root), []);
});

test('aggregates Python app-to-Core internal imports as counted migration debt', t => {
  const root = fixture(t, {
    'apps/cognition-worker/src/glimmer_cradle/cognition_worker/composition.py':
      'from glimmer_cradle.cognition.adapters.clock import SystemClock\nfrom glimmer_cradle.cognition.state import CognitiveState\n',
    'core/cognition/src/glimmer_cradle/cognition/__init__.py': '',
  });
  const findings = collectV2Violations(root).filter(item => item.rule === 'deep-import');
  assert.equal(findings.length, 2);
  assert.deepEqual(new Set(findings.map(item => item.detail)), new Set(['glimmer_cradle.cognition.*']));
});

test('rejects Cognition direct system capabilities, internal Ports and mutable locators', t => {
  const root = fixture(t, {
    'core/cognition/src/glimmer_cradle/cognition/loop/unsafe.py': [
      'import datetime as dt',
      'from uuid import uuid4 as make_uuid',
      '_registry = {}',
      'class HiddenPort: pass',
      'def bind(value): _registry["value"] = value',
      'def create(): return dt.datetime.now(), make_uuid()',
    ].join('\n'),
  });
  const findings = collectV2Violations(root);
  assert(findings.some(item => item.rule === 'internal-port' && item.detail === 'HiddenPort'));
  assert(findings.some(item => item.rule === 'module-mutable' && item.detail === '_registry'));
  assert(findings.some(item => item.rule === 'direct-system-capability' && item.detail === 'datetime.datetime.now'));
  assert(findings.some(item => item.rule === 'direct-system-capability' && item.detail === 'uuid.uuid4'));
});

test('detect source cycles and package cycles, including manifests without source imports', t => {
  const root = fixture(t, {
    'core/content/package.json': JSON.stringify({ name: '@glimmer-cradle/content', exports: { '.': './src/index.ts' }, dependencies: { '@glimmer-cradle/cognition': '*' } }),
    'core/cognition/package.json': JSON.stringify({ name: '@glimmer-cradle/cognition', exports: { '.': './src/index.ts' }, dependencies: { '@glimmer-cradle/content': '*' } }),
    'core/content/src/a.ts': `import './b';`,
    'core/content/src/b.ts': `import './a';`,
  });
  const findings = collectV2Violations(root);
  for (const rule of ['source-cycle', 'package-cycle', 'dependency-direction']) assert.ok(findings.some(item => item.rule === rule));
  assert.deepEqual(findImportCycles(new Map([['a', new Set(['a'])]])), [['a']]);
});

test('legacy exceptions cannot hide additional violations or survive removal', () => {
  const item = { file: 'core/kernel/a.ts', rule: 'core-sdk', detail: '@glimmer-cradle/extension-sdk', line: 1 };
  const exception = { ...item, count: 1, owner: 'v2-refactor', removeBy: 'phase-9', reason: 'Migrate host composition' };
  assert.deepEqual(applyV2Exceptions([item], [exception]), []);
  assert.equal(applyV2Exceptions([item, item], [exception]).length, 1);
  assert.equal(applyV2Exceptions([], [exception]).length, 1);
  assert.equal(applyV2Exceptions([item], []).length, 1);
  assert.equal(applyV2Exceptions([item], [exception, exception]).length, 1);
});

test('Python AST covers multiline imports, relative cycles and vendor types, excluding comments and docstrings', t => {
  const root = fixture(t, {
    'core/platform/src/glimmer_cradle/platform/__init__.py': '',
    'core/platform/src/glimmer_cradle/platform/a.py': '"""OpenAI mentioned in docs only."""\n# Discord comment\nfrom . import b\nfrom glimmer_cradle.cognition.internal import (\n    Item,\n)\nclass QQImage: pass\n',
    'core/platform/src/glimmer_cradle/platform/b.py': 'from . import a\n',
  });
  const findings = collectV2Violations(root);
  for (const rule of ['dependency-direction', 'deep-import', 'vendor-core', 'source-cycle']) assert.ok(findings.some(item => item.rule === rule), rule);
  assert.deepEqual(findings.filter(item => item.rule === 'vendor-core').map(item => item.detail), ['QQ']);
  assert.ok(!findings.some(item => item.rule === 'python-analysis'));
});
