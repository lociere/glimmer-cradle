import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AssetRef, AssetStorePort } from '@glimmer-cradle/content';
import { resolveStatePath, resolveWorkPath } from '../filesystem/path-utils';

export const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class FileAssetStore implements AssetStorePort {
  constructor(
    private readonly stateRoot = resolveStatePath('content/assets'),
    private readonly workRoot = resolveWorkPath('content/uploads'),
    private readonly ephemeral = false,
  ) {}

  public async put(source: AsyncIterable<Uint8Array>, mediaType: string): Promise<AssetRef> {
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(mediaType)) throw new Error('非法媒体类型');
    await mkdir(this.stateRoot, { recursive: true });
    await mkdir(this.workRoot, { recursive: true });
    const assetId = randomUUID();
    const workPath = path.join(this.workRoot, `${assetId}.upload`);
    const stagingDir = path.join(this.stateRoot, `.${assetId}.staging`);
    const finalDir = path.join(this.stateRoot, assetId);
    const digest = createHash('sha256');
    let sizeBytes = 0;
    try {
      const handle = await open(workPath, 'wx', 0o600);
      try {
        for await (const chunk of source) {
          if (!(chunk instanceof Uint8Array)) throw new Error('媒体块必须是字节数组');
          sizeBytes += chunk.byteLength;
          if (sizeBytes > MAX_ASSET_BYTES) throw new Error('媒体超过 256 MiB 上限');
          digest.update(chunk);
          await handle.writeFile(chunk);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (sizeBytes === 0) throw new Error('媒体内容为空');
      const ref: AssetRef = { assetId, mediaType, sizeBytes, sha256: digest.digest('hex') };
      await mkdir(stagingDir, { mode: 0o700 });
      await copyFile(workPath, path.join(stagingDir, 'blob'));
      const metadata = await open(path.join(stagingDir, 'metadata.json'), 'wx', 0o600);
      try {
        await metadata.writeFile(`${JSON.stringify(ref)}\n`, 'utf8');
        await metadata.sync();
      } finally {
        await metadata.close();
      }
      await rename(stagingDir, finalDir);
      return ref;
    } finally {
      await rm(workPath, { force: true });
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  public async inspect(assetId: string): Promise<AssetRef | null> {
    this.assertAssetId(assetId);
    let metadata: string;
    try {
      metadata = await readFile(path.join(this.stateRoot, assetId, 'metadata.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const ref = JSON.parse(metadata) as AssetRef;
    if (
      ref.assetId !== assetId || typeof ref.mediaType !== 'string'
      || !Number.isSafeInteger(ref.sizeBytes) || ref.sizeBytes <= 0 || ref.sizeBytes > MAX_ASSET_BYTES
      || !/^[0-9a-f]{64}$/.test(ref.sha256)
    ) throw new Error('资产元数据损坏');
    return ref;
  }

  public async *open(ref: AssetRef): AsyncIterable<Uint8Array> {
    const stored = await this.inspect(ref.assetId);
    if (
      !stored || stored.mediaType !== ref.mediaType || stored.sizeBytes !== ref.sizeBytes
      || stored.sha256 !== ref.sha256
    ) throw new Error('资产引用与存储元数据不一致');
    const blobPath = path.join(this.stateRoot, ref.assetId, 'blob');
    const fileStat = await stat(blobPath);
    if (fileStat.size !== ref.sizeBytes) throw new Error('资产大小校验失败');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(blobPath)) hash.update(chunk);
    if (hash.digest('hex') !== ref.sha256) throw new Error('资产摘要校验失败');
    yield* createReadStream(blobPath);
  }

  public async release(ref: AssetRef): Promise<void> {
    if (!this.ephemeral) throw new Error('持久资产不能按租约删除');
    const stored = await this.inspect(ref.assetId);
    if (stored && stored.sha256 === ref.sha256) {
      await rm(path.join(this.stateRoot, ref.assetId), { recursive: true, force: true });
    }
  }

  public async sweepExpired(maxAgeMs: number, nowMs: number): Promise<void> {
    if (!this.ephemeral) throw new Error('持久资产不能按租约清理');
    let entries;
    try { entries = await readdir(this.stateRoot, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !ASSET_ID_PATTERN.test(entry.name)) continue;
      const target = path.join(this.stateRoot, entry.name);
      try {
        if ((await stat(target)).mtimeMs + maxAgeMs <= nowMs) await rm(target, { recursive: true, force: true });
      } catch { /* 其他任务可能已释放 */ }
    }
  }

  private assertAssetId(assetId: string): void {
    if (!ASSET_ID_PATTERN.test(assetId)) throw new Error('非法资产 ID');
  }
}
