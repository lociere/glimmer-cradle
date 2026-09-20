import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AssetRef } from '@glimmer-cradle/content';
import { resolveWorkPath } from '../filesystem/path-utils';
import { FileAssetStore, MAX_ASSET_BYTES } from './file-asset-store';

export const MAX_UPLOAD_CHUNK_BYTES = 1024 * 1024;
export const UPLOAD_TTL_MS = 30 * 60 * 1000;

type Upload = {
  owner: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  written: number;
  expiresAt: number;
  path: string;
  busy: boolean;
};

/** Kernel alone owns upload tokens and their binding to one extension event. */
export class StagedAssetUploads {
  private readonly uploads = new Map<string, Upload>();

  constructor(
    private readonly durableStore: FileAssetStore,
    private readonly transientStore: FileAssetStore,
    private readonly stageRoot = resolveWorkPath('content/staged'),
    private readonly now: () => number = Date.now,
  ) {
    setInterval(() => { void this.sweep().catch(() => undefined); }, 60_000).unref();
  }

  public async begin(owner: string, mediaType: string, sizeBytes: number, sha256: string): Promise<string> {
    await this.sweep();
    if (!owner || !/^[\w.+-]+\/[\w.+-]+$/.test(mediaType)
      || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_ASSET_BYTES
      || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('上传声明无效');
    await mkdir(this.stageRoot, { recursive: true });
    const token = randomUUID();
    const filePath = path.join(this.stageRoot, `${token}.upload`);
    const handle = await open(filePath, 'wx', 0o600);
    await handle.close();
    this.uploads.set(token, { owner, mediaType, sizeBytes, sha256, written: 0,
      expiresAt: this.now() + UPLOAD_TTL_MS, path: filePath, busy: false });
    return token;
  }

  public async write(owner: string, token: string, chunk: Uint8Array): Promise<void> {
    const upload = this.get(owner, token);
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 || chunk.byteLength > MAX_UPLOAD_CHUNK_BYTES) {
      await this.abort(owner, token);
      throw new Error('上传块大小无效');
    }
    if (upload.busy) throw new Error('同一上传不可并发写入');
    if (upload.written + chunk.byteLength > upload.sizeBytes) {
      await this.abort(owner, token);
      throw new Error('上传超过声明大小');
    }
    upload.busy = true;
    try {
      const handle = await open(upload.path, 'a');
      try { await handle.writeFile(chunk); } finally { await handle.close(); }
      upload.written += chunk.byteLength;
    } catch (error) {
      await this.abort(owner, token);
      throw error;
    } finally { upload.busy = false; }
  }

  public async consume(owner: string, token: string, retention: 'transient' | 'experience' | 'memory_candidate', kind?: string): Promise<AssetRef> {
    const upload = this.get(owner, token);
    if (upload.busy) throw new Error('上传写入尚未完成');
    // One-use token is invalidated before any asynchronous commit starts.
    this.uploads.delete(token);
    try {
      if (kind && kind !== 'file' && !upload.mediaType.startsWith(`${kind}/`)) throw new Error('ContentPart 类型与媒体类型不一致');
      if (upload.written !== upload.sizeBytes) throw new Error('上传未完成');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(upload.path)) hash.update(chunk);
      if (hash.digest('hex') !== upload.sha256) throw new Error('上传摘要不匹配');
      const store = retention === 'transient' ? this.transientStore : this.durableStore;
      return await store.put(createReadStream(upload.path), upload.mediaType);
    } finally { await rm(upload.path, { force: true }); }
  }

  public async abort(owner: string, token: string): Promise<void> {
    const upload = this.get(owner, token);
    this.uploads.delete(token);
    await rm(upload.path, { force: true });
  }

  public async discard(owner: string, token: string): Promise<void> {
    const upload = this.uploads.get(token);
    if (!upload || upload.owner !== owner) return;
    this.uploads.delete(token);
    await rm(upload.path, { force: true });
  }

  public async releaseTransient(ref: AssetRef): Promise<void> {
    await this.transientStore.release(ref);
  }

  public async sweep(): Promise<void> {
    for (const [token, upload] of this.uploads) {
      if (upload.expiresAt > this.now() || upload.busy) continue;
      this.uploads.delete(token);
      await rm(upload.path, { force: true });
    }
    await this.sweepOrphans();
    await this.transientStore.sweepExpired(UPLOAD_TTL_MS, this.now());
  }

  private async sweepOrphans(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.stageRoot); } catch { return; }
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.upload$/.test(name)) continue;
      const filePath = path.join(this.stageRoot, name);
      if (this.uploads.has(name.slice(0, -7))) continue;
      try {
        if ((await stat(filePath)).mtimeMs + UPLOAD_TTL_MS <= this.now()) await rm(filePath, { force: true });
      } catch { /* another cleanup owns it */ }
    }
  }

  private get(owner: string, token: string): Upload {
    const upload = this.uploads.get(token);
    if (!upload || upload.owner !== owner) throw new Error('上传 token 无效或无权使用');
    if (upload.expiresAt <= this.now()) {
      this.uploads.delete(token);
      void rm(upload.path, { force: true }).catch(() => undefined);
      throw new Error('上传 token 已过期');
    }
    return upload;
  }
}
