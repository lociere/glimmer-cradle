import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface LocalExtensionUploadAuthorization {
  readonly principalId: string;
  readonly sessionBinding: string;
}

export interface LocalExtensionUploadRecord {
  readonly upload_id: string;
  readonly file_name: string;
  readonly size: number;
  readonly expires_at: string;
}

interface StoredUploadEntry {
  uploadId: string;
  fileName: string;
  size: number;
  filePath: string;
  principalId: string;
  sessionBinding: string;
  expiresAt: number;
  status: 'uploaded' | 'preparing';
  prepareRequestId?: string;
}

export class LocalExtensionUploadStore {
  private readonly uploads = new Map<string, StoredUploadEntry>();
  private readonly prepareRequests = new Map<string, string>();

  public constructor(
    private readonly uploadRoot: string,
    private readonly options: {
      readonly retentionMs: number;
      readonly now?: () => number;
    },
  ) {}

  public async initialize(): Promise<void> {
    await mkdir(this.uploadRoot, { recursive: true });
    await this.clearUploadRoot();
  }

  public async storeUpload(
    fileName: string,
    bytes: Uint8Array,
    authorization: LocalExtensionUploadAuthorization,
  ): Promise<LocalExtensionUploadRecord> {
    await this.pruneExpired();
    const uploadId = `upload_${randomUUID()}`;
    const expiresAt = this.now() + this.options.retentionMs;
    const filePath = path.join(this.uploadRoot, `${uploadId}-${fileName}`);
    await writeFile(filePath, bytes);
    this.uploads.set(uploadId, {
      uploadId,
      fileName,
      size: bytes.byteLength,
      filePath,
      principalId: authorization.principalId,
      sessionBinding: authorization.sessionBinding,
      expiresAt,
      status: 'uploaded',
    });
    return {
      upload_id: uploadId,
      file_name: fileName,
      size: bytes.byteLength,
      expires_at: new Date(expiresAt).toISOString(),
    };
  }

  public async materializeUploadForPrepare(
    uploadId: string,
    requestId: string,
    authorization: LocalExtensionUploadAuthorization,
  ): Promise<{ path: string }> {
    await this.pruneExpired();
    const entry = this.getAuthorizedUpload(uploadId, authorization);
    if (entry.status !== 'uploaded') {
      throw new Error('本地扩展上传已被消费，请重新上传 .gcex 包。');
    }
    entry.status = 'preparing';
    entry.prepareRequestId = requestId;
    this.prepareRequests.set(requestId, uploadId);
    return { path: entry.filePath };
  }

  public async finalizePrepare(requestId: string, transactionId?: string): Promise<void> {
    await this.pruneExpired();
    const uploadId = this.prepareRequests.get(requestId);
    if (!uploadId) return;
    this.prepareRequests.delete(requestId);
    const entry = this.uploads.get(uploadId);
    if (!entry) return;
    entry.prepareRequestId = undefined;
    await this.removeFile(entry.filePath);
    this.uploads.delete(uploadId);
  }

  public async abortPrepare(requestId: string): Promise<void> {
    await this.pruneExpired();
    const uploadId = this.prepareRequests.get(requestId);
    if (!uploadId) return;
    this.prepareRequests.delete(requestId);
    const entry = this.uploads.get(uploadId);
    if (!entry || entry.status !== 'preparing' || entry.prepareRequestId !== requestId) return;
    entry.status = 'uploaded';
    entry.prepareRequestId = undefined;
  }

  public async discardPrepare(requestId: string): Promise<void> {
    await this.pruneExpired();
    const uploadId = this.prepareRequests.get(requestId);
    if (!uploadId) return;
    this.prepareRequests.delete(requestId);
    const entry = this.uploads.get(uploadId);
    if (!entry) return;
    await this.removeFile(entry.filePath);
    this.uploads.delete(uploadId);
  }

  public async disposeSessionUploads(authorization: LocalExtensionUploadAuthorization): Promise<void> {
    await this.pruneExpired();
    for (const [uploadId, entry] of this.uploads) {
      if (entry.principalId !== authorization.principalId || entry.sessionBinding !== authorization.sessionBinding) continue;
      if (entry.prepareRequestId) this.prepareRequests.delete(entry.prepareRequestId);
      await this.removeFile(entry.filePath);
      this.uploads.delete(uploadId);
    }
  }

  private getAuthorizedUpload(
    uploadId: string,
    authorization: LocalExtensionUploadAuthorization,
  ): StoredUploadEntry {
    const entry = this.uploads.get(uploadId);
    if (!entry) {
      throw new Error('本地扩展上传不存在、已过期或已被清理。');
    }
    if (entry.principalId !== authorization.principalId || entry.sessionBinding !== authorization.sessionBinding) {
      throw new Error('本地扩展上传只允许创建它的当前登录会话继续使用。');
    }
    return entry;
  }

  private async pruneExpired(): Promise<void> {
    const now = this.now();
    for (const [uploadId, entry] of this.uploads) {
      if (entry.expiresAt > now) continue;
      if (entry.prepareRequestId) this.prepareRequests.delete(entry.prepareRequestId);
      await this.removeFile(entry.filePath);
      this.uploads.delete(uploadId);
    }
  }

  private async clearUploadRoot(): Promise<void> {
    const entries = await readdir(this.uploadRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      await rm(path.join(this.uploadRoot, entry.name), { recursive: true, force: true });
    }));
  }

  private async removeFile(filePath: string): Promise<void> {
    await rm(filePath, { force: true }).catch(() => undefined);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
