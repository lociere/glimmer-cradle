import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkDocs, localMarkdownTargets } from '../src/docs/check-docs.mjs';

test('local targets include reference definitions and exclude code and external URLs', () => {
  assert.deepEqual(localMarkdownTargets('[page](./a.md#title)\n[ref]: ./b.md\n`[code](missing.md)`\n```md\n[x](absent.md)\n```\n[x](https://example.test)\n[x](#anchor)'), ['./a.md#title', './b.md']);
});

test('encoded links, directory indexes, missing targets and orphan pages are distinguished', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-docs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  write('docs/README.md', '[guide](./guide/)');
  write('docs/guide/README.md', '[name](./with%20space.md)');
  write('docs/guide/with space.md', '# Guide');
  write('docs/history/old.md', '[old](missing.md)');
  assert.deepEqual(checkDocs(root), { activeFiles: 3, errors: [] });
  write('docs/orphan.md', '[bad](missing.md)');
  const result = checkDocs(root);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some(error => error.includes('missing local target')));
  assert.ok(result.errors.some(error => error.includes('not reachable')));
});
