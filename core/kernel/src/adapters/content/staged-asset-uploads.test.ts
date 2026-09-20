import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FileAssetStore } from './file-asset-store';
import { MAX_UPLOAD_CHUNK_BYTES, StagedAssetUploads, UPLOAD_TTL_MS } from './staged-asset-uploads';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-upload-'));
  roots.push(root);
  const state = path.join(root, 'state');
  const work = path.join(root, 'work');
  const stage = path.join(root, 'stage');
  let now = 1000;
  const uploads = new StagedAssetUploads(new FileAssetStore(state, work),
    new FileAssetStore(path.join(root, 'transient'), work, true), stage, () => now);
  return { uploads, state, stage, transient: path.join(root, 'transient'), advance: (ms: number) => { now += ms; } };
}

const data = Buffer.from('part one + part two');
const digest = createHash('sha256').update(data).digest('hex');

it('binds one token to its extension and consumes it once into a verified durable asset', async () => {
  const { uploads, state } = await fixture();
  const token = await uploads.begin('a', 'image/png', data.length, digest);
  await expect(uploads.write('b', token, data)).rejects.toThrow('无权');
  await uploads.write('a', token, data.subarray(0, 5));
  await uploads.write('a', token, data.subarray(5));
  await expect(uploads.consume('b', token, 'experience', 'image')).rejects.toThrow('无权');
  const ref = await uploads.consume('a', token, 'experience', 'image');
  expect(ref.sha256).toBe(digest);
  expect(await new FileAssetStore(state, path.join(state, 'unused')).inspect(ref.assetId)).toEqual(ref);
  await expect(uploads.consume('a', token, 'experience')).rejects.toThrow('无效');
});

it('keeps transient media only for its consumption lease', async () => {
  const { uploads, transient } = await fixture();
  const token = await uploads.begin('a', 'audio/wav', data.length, digest);
  await uploads.write('a', token, data);
  const ref = await uploads.consume('a', token, 'transient', 'audio');
  expect(await new FileAssetStore(transient, path.join(transient, 'unused')).inspect(ref.assetId)).toEqual(ref);
  await uploads.releaseTransient(ref);
  expect(await new FileAssetStore(transient, path.join(transient, 'unused')).inspect(ref.assetId)).toBeNull();
});

it('cleans interrupted, oversized, wrong digest and expired stages', async () => {
  const { uploads, stage, advance } = await fixture();
  await expect(uploads.begin('a', 'image/png', 256 * 1024 * 1024 + 1, digest)).rejects.toThrow('无效');
  let token = await uploads.begin('a', 'image/png', 1, digest);
  await expect(uploads.write('a', token, Buffer.alloc(MAX_UPLOAD_CHUNK_BYTES + 1))).rejects.toThrow('块大小');
  expect(await readdir(stage)).toEqual([]);
  token = await uploads.begin('a', 'image/png', data.length, digest);
  await uploads.write('a', token, data);
  await expect(uploads.consume('a', token, 'experience', 'audio')).rejects.toThrow('媒体类型');
  await expect(uploads.consume('a', token, 'experience', 'image')).rejects.toThrow('无效');
  token = await uploads.begin('a', 'image/png', data.length, digest);
  await uploads.write('a', token, Buffer.alloc(data.length));
  await expect(uploads.consume('a', token, 'experience', 'image')).rejects.toThrow('摘要');
  token = await uploads.begin('a', 'image/png', data.length, digest);
  await uploads.write('a', token, data.subarray(0, 1));
  await expect(uploads.consume('a', token, 'experience', 'image')).rejects.toThrow('未完成');
  token = await uploads.begin('a', 'image/png', data.length, digest);
  advance(UPLOAD_TTL_MS + 1);
  await uploads.sweep();
  await expect(uploads.write('a', token, data)).rejects.toThrow('无效');
  expect(await readdir(stage)).toEqual([]);
});
