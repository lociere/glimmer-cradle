import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openLocalFile } from '../src/main/local-file-action.ts';

test('本地文件与目录交给系统默认应用，系统打开失败不能报告成功', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'desktop-file-action-'));
  try {
    const file = path.join(root, 'read me.txt');
    await writeFile(file, 'test', 'utf8');
    const opened: string[] = [];
    const open = async (target: string) => { opened.push(target); return ''; };
    assert.deepEqual(await openLocalFile(file, open), { ok: true, path: await realpath(file) });
    await openLocalFile(root, open);
    assert.equal(opened.length, 2);
    await assert.rejects(openLocalFile(file, async () => 'no application'), /no application/);
    await assert.rejects(openLocalFile(path.join(root, 'missing'), open));
    assert.equal(opened.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('相对、空、网络与设备路径不会进入系统打开入口', async () => {
  for (const value of [undefined, '', 'relative.txt', 'https://example.com', '\\\\server\\share', '\\\\?\\C:\\Windows', 'C:\\bad\0path']) {
    await assert.rejects(openLocalFile(value, async () => { assert.fail('must not open'); }));
  }
});
