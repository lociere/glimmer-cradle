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
