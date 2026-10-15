import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkDocs, localMarkdownTargets } from '../src/docs/check-docs.mjs';

test('local targets include reference definitions and exclude code and external URLs', () => {
  assert.deepEqual(localMarkdownTargets('[page](./a.md#title)\n\n[ref]: ./b.md\n\n`[code](missing.md)`\n```md\n[x](absent.md)\n```\n[x](https://example.test)\n[x](#anchor)'), ['./a.md#title', './b.md']);
});

test('renaming a linked section fails until its consumer follows the actual heading', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-heading-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/README.md'), '[run](./run.md#准备-host)\n[again](./run.md#准备-host-1)\n[restore](./run.md#恢复状态)');
  const target = path.join(root, 'docs/run.md');
  fs.writeFileSync(target, '# Run\n\n## 准备 `Host`\n\n## 准备 **Host**\n\n恢复状态\n---\n');
  assert.deepEqual(checkDocs(root).errors, []);
  fs.writeFileSync(target, '# Run\n\n## 新的章节\n');
  assert.equal(checkDocs(root).errors.filter(error => error.includes('missing Markdown heading')).length, 3);
  fs.writeFileSync(path.join(root, 'docs/README.md'), '[run](./run.md#新的章节)');
  assert.deepEqual(checkDocs(root).errors, []);
});

test('self and encoded section links work while code examples do not create anchors', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-heading-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/guide'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/README.md'), '# Start\n\n[self](#start)\n[guide](./guide/#%E6%81%A2%E5%A4%8D)');
  fs.writeFileSync(path.join(root, 'docs/guide/README.md'), '# Guide\n\n## 恢复\n\n```md\n## 示例章节\n[ignored](missing.md#nope)\n```\n\n[broken](#示例章节)');
  assert.deepEqual(checkDocs(root).errors, ['docs/guide/README.md: missing Markdown heading: #示例章节']);
  fs.writeFileSync(path.join(root, 'docs/guide/README.md'), '# Guide\n\n## 恢复\n\n[bad](#%ZZ)');
  assert.ok(checkDocs(root).errors.some(error => error.includes('invalid link encoding')));
});

test('YAML metadata and inline code are not interpreted as Markdown navigation', () => {
  assert.deepEqual(localMarkdownTargets('---\nname: sample\ndescription: "[not a link](secret.md)"\n---\n# Guide\n\n[real](./real.md#section)\n\n`[ignored](missing.md)`'), ['./real.md#section']);
  assert.deepEqual(localMarkdownTargets('[nested](./some_(file).md#section "Title")\n[angle](<./with space.md#section>)'), ['./some_(file).md#section', './with space.md#section']);
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
