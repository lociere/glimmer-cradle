import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FileAssetStore } from './file-asset-store';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-content-'));
  roots.push(root);
  const state = path.join(root, 'state');
  const work = path.join(root, 'work');
  return { state, work, store: new FileAssetStore(state, work) };
}

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

it('keeps verified bytes readable across store construction without exposing a path', async () => {
  const { state, work, store } = await fixture();
  const ref = await store.put(chunks('first', ' second'), 'text/plain');
  expect(ref).toMatchObject({ mediaType: 'text/plain', sizeBytes: 12 });
  expect(ref).not.toHaveProperty('uri');
  const reopened = new FileAssetStore(state, work);
  const bytes: Uint8Array[] = [];
  for await (const chunk of reopened.open(ref)) bytes.push(chunk);
  expect(Buffer.concat(bytes).toString()).toBe('first second');
  expect(await reopened.inspect(ref.assetId)).toEqual(ref);
});

it('rejects corrupted bytes and forged or path-traversal references', async () => {
  const { state, store } = await fixture();
  const ref = await store.put(chunks('trusted'), 'image/png');
  await expect(store.inspect('../escape')).rejects.toThrow('非法资产 ID');
  const forged = { ...ref, sha256: '0'.repeat(64) };
  await expect(async () => {
    for await (const _chunk of store.open(forged)) { /* consume */ }
  }).rejects.toThrow('资产引用与存储元数据不一致');
  const blob = path.join(state, ref.assetId, 'blob');
  const original = await readFile(blob);
  await writeFile(blob, Buffer.from('x'.repeat(original.length)));
  await expect(async () => {
    for await (const _chunk of store.open(ref)) { /* consume */ }
  }).rejects.toThrow('资产摘要校验失败');
});

it('rejects empty uploads and cleans temporary material', async () => {
  const { work, store } = await fixture();
  await expect(store.put(chunks(), 'image/png')).rejects.toThrow('媒体内容为空');
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(work)).toEqual([]);
});

it('restores a committed asset from a state-directory backup', async () => {
  const { state, work, store } = await fixture();
  const ref = await store.put(chunks('backup payload'), 'application/octet-stream');
  const restoredState = `${state}-restored`;
  await cp(state, restoredState, { recursive: true });
  const restored = new FileAssetStore(restoredState, work);
  const bytes: Uint8Array[] = [];
  for await (const chunk of restored.open(ref)) bytes.push(chunk);
  expect(Buffer.concat(bytes).toString()).toBe('backup payload');
  await rm(restoredState, { recursive: true, force: true });
});
