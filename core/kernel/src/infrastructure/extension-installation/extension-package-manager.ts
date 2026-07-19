import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'node:path';
import {
  EXTENSION_ID_PATTERN,
  EXTENSION_VERSION_PATTERN,
  validateExtensionRegistryCatalog,
  validateExtensionReleaseManifest,
  type ExtensionContractValidation,
  type ExtensionManifest,
  type ExtensionPlatform,
  type ExtensionProductTarget,
  type ExtensionReleaseArtifact,
  type ExtensionReleaseManifest,
} from '@glimmer-cradle/protocol';
import { resolveCachePath, resolveStatePath } from '../../foundation/utils/path-utils';
import {
  extractVerifiedExtensionPackage,
  verifyExtensionPackage,
  type VerifiedExtensionPackage,
} from './extension-package-verifier';
import { OutboundUrlPolicy } from './outbound-url-policy';

export type ExtensionReleaseChannel = ExtensionReleaseManifest['channel'];

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TRANSACTION_TTL_MS = 30 * 60 * 1000;
const TRANSACTION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const outboundUrlPolicy = new OutboundUrlPolicy();

export type ExtensionInstallSource =
  | { kind: 'file'; path: string }
  | { kind: 'release_manifest'; url: string }
  | { kind: 'registry'; catalog_url: string; extension_id: string; channel?: ExtensionReleaseChannel }
  | { kind: 'repository'; repository: string; tag: string };

export interface ExtensionInstallTrust {
  source_kind: ExtensionInstallSource['kind'];
  listing_reviewed: boolean;
  publisher_verified: boolean;
  artifact_signed: boolean;
  build_attested: boolean;
  registry_id?: string;
  repository?: string;
}

export interface ExtensionInstallPreview {
  transaction_id: string;
  extension: {
    id: string;
    name: string;
    version: string;
    publisher: string;
    description?: string;
    permissions: string[];
    products: ExtensionProductTarget[];
    platforms: ExtensionPlatform[];
  };
  artifact: { sha256: string; size: number; platform: ExtensionPlatform };
  trust: ExtensionInstallTrust;
}

export interface ExtensionInstallResult {
  extension_id: string;
  version: string;
  installed_path: string;
  already_installed: boolean;
}

interface ResolvedInstallSource {
  packagePath: string;
  platform: ExtensionPlatform;
  expectedSha256?: string;
  expectedSize?: number;
  expectedExtensionId?: string;
  expectedVersion?: string;
  trust: ExtensionInstallTrust;
}

interface PendingInstall {
  preview: ExtensionInstallPreview;
  packagePath: string;
  verified: VerifiedExtensionPackage;
  createdAt: number;
}

export class ExtensionPackageManager {
  private readonly pending = new Map<string, PendingInstall>();
  private readonly cacheRoot = resolveCachePath(path.join('extensions', 'package-manager'));
  private readonly stateRoot = resolveStatePath(path.join('kernel', 'extension-installations'));
  private readonly transactionRoot: string;
  private readonly stagingRoot: string;
  private initialized = false;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly extensionRoot: string;
  private readonly productId: Exclude<ExtensionProductTarget, 'any'>;

  public constructor(
    extensionRoot: string,
    productId: Exclude<ExtensionProductTarget, 'any'> = 'desktop',
  ) {
    this.extensionRoot = extensionRoot;
    this.productId = productId;
    this.transactionRoot = path.join(this.cacheRoot, 'transactions');
    this.stagingRoot = path.join(this.extensionRoot, '.staging');
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.ensureDir(this.transactionRoot);
    await fs.ensureDir(this.stagingRoot);
    await this.sweepTransactionArtifacts();
    await this.sweepStagingArtifacts();
    this.cleanupTimer = setInterval(() => {
      void Promise.all([
        this.sweepTransactionArtifacts(),
        this.sweepStagingArtifacts(),
      ]);
    }, TRANSACTION_SWEEP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
    this.initialized = true;
  }

  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.initialized = false;
  }

  public async prepareInstall(source: ExtensionInstallSource): Promise<ExtensionInstallPreview> {
    await this.ensureInitialized();
    await this.sweepTransactionArtifacts();
    const transactionId = randomUUID();
    const transactionRoot = path.join(this.transactionRoot, transactionId);
    await fs.ensureDir(transactionRoot);
    try {
      const resolved = await this.resolveSource(source, transactionRoot);
      const verified = await verifyExtensionPackage(resolved.packagePath, { maxArchiveBytes: MAX_PACKAGE_BYTES });
      this.assertResolvedArtifact(resolved, verified);
      const preview: ExtensionInstallPreview = {
        transaction_id: transactionId,
        extension: {
          id: verified.manifest.id,
          name: verified.manifest.name,
          version: verified.manifest.version,
          publisher: verified.manifest.publisher,
          ...(verified.manifest.description ? { description: verified.manifest.description } : {}),
          permissions: [...verified.manifest.permissions],
          products: [...verified.manifest.products],
          platforms: [...verified.manifest.platforms],
        },
        artifact: {
          sha256: verified.archiveSha256,
          size: verified.archiveSize,
          platform: resolved.platform,
        },
        trust: resolved.trust,
      };
      this.pending.set(transactionId, {
        preview,
        packagePath: resolved.packagePath,
        verified,
        createdAt: Date.now(),
      });
      return preview;
    } catch (error) {
      await fs.remove(transactionRoot);
      throw error;
    }
  }

  public async commitInstall(transactionId: string, approvedPermissions: string[]): Promise<ExtensionInstallResult> {
    await this.ensureInitialized();
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error('扩展安装事务不存在或已经过期');
    assertSameStringSet(pending.preview.extension.permissions, approvedPermissions, '用户确认的权限与安装预览不一致');

    const verified = await verifyExtensionPackage(pending.packagePath, { maxArchiveBytes: MAX_PACKAGE_BYTES });
    if (verified.archiveSha256 !== pending.preview.artifact.sha256) {
      throw new Error('扩展包在用户确认后发生变化，安装已取消');
    }

    const targetDir = path.join(this.extensionRoot, verified.manifest.id, verified.manifest.version);
    const existingManifestPath = path.join(targetDir, 'extension-manifest.yaml');
    if (await fs.pathExists(existingManifestPath)) {
      const metadata = await this.readInstallationMetadata(verified.manifest.id, verified.manifest.version);
      if (metadata?.artifact_sha256 !== verified.archiveSha256) {
        throw new Error(`不可变扩展版本已经存在且摘要不同: ${verified.manifest.id}@${verified.manifest.version}`);
      }
      await this.finishTransaction(transactionId);
      return {
        extension_id: verified.manifest.id,
        version: verified.manifest.version,
        installed_path: targetDir,
        already_installed: true,
      };
    }

    const stagingDir = path.join(this.stagingRoot, transactionId);
    let movedToTarget = false;
    await fs.remove(stagingDir);
    try {
      await extractVerifiedExtensionPackage(verified, stagingDir);
      await fs.ensureDir(path.dirname(targetDir));
      if (await fs.pathExists(targetDir)) throw new Error(`扩展安装目标已存在: ${targetDir}`);
      await fs.move(stagingDir, targetDir, { overwrite: false });
      movedToTarget = true;
      await this.writeInstallationMetadata(verified.manifest, pending.preview);
      return {
        extension_id: verified.manifest.id,
        version: verified.manifest.version,
        installed_path: targetDir,
        already_installed: false,
      };
    } catch (error) {
      if (movedToTarget) {
        await fs.remove(targetDir).catch(() => undefined);
      }
      throw error;
    } finally {
      await fs.remove(stagingDir).catch(() => undefined);
      await this.finishTransaction(transactionId);
    }
  }

  public async cancelInstall(transactionId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.pending.has(transactionId)) return;
    await this.finishTransaction(transactionId);
  }

  public async uninstall(extensionId: string, version: string, active: boolean): Promise<void> {
    if (!EXTENSION_ID_PATTERN.test(extensionId) || !EXTENSION_VERSION_PATTERN.test(version)) {
      throw new Error('无效的扩展卸载身份或版本');
    }
    if (active) throw new Error(`不能卸载当前激活版本: ${extensionId}@${version}`);
    const targetDir = path.join(this.extensionRoot, extensionId, version);
    if (!isPathInside(this.extensionRoot, targetDir)) throw new Error('非法扩展卸载路径');
    await fs.remove(targetDir);
    await fs.remove(path.join(this.stateRoot, extensionId, `${version}.json`));
    const extensionDir = path.dirname(targetDir);
    if (await fs.pathExists(extensionDir) && (await fs.readdir(extensionDir)).length === 0) await fs.remove(extensionDir);
  }

  private async resolveSource(source: ExtensionInstallSource, transactionRoot: string): Promise<ResolvedInstallSource> {
    if (source.kind === 'file') {
      const sourcePath = path.resolve(source.path);
      if (path.extname(sourcePath).toLowerCase() !== '.gcex') throw new Error('本地扩展包必须使用 .gcex 后缀');
      const packagePath = path.join(transactionRoot, path.basename(sourcePath));
      await fs.copyFile(sourcePath, packagePath);
      return {
        packagePath,
        platform: currentExtensionPlatform(),
        trust: emptyTrust('file'),
      };
    }
    if (source.kind === 'release_manifest') {
      return this.resolveReleaseManifest(source.url, transactionRoot, emptyTrust('release_manifest'));
    }
    if (source.kind === 'registry') {
      const catalog = requireValid(
        'Extension Registry Catalog',
        validateExtensionRegistryCatalog(await fetchJson(source.catalog_url)),
      );
      const record = catalog.extensions.find((item) => item.id === source.extension_id);
      if (!record) throw new Error(`Registry 中不存在扩展: ${source.extension_id}`);
      if (record.listing_status !== 'approved' || record.security_status === 'blocked' || record.security_status === 'withdrawn') {
        throw new Error(`Registry 当前不允许安装扩展: ${source.extension_id}`);
      }
      const channel = source.channel ?? 'stable';
      const manifestUrl = record.channels[channel];
      if (!manifestUrl) throw new Error(`扩展没有发布 ${channel} channel: ${source.extension_id}`);
      return this.resolveReleaseManifest(manifestUrl, transactionRoot, {
        source_kind: 'registry',
        listing_reviewed: true,
        publisher_verified: record.publisher_verification === 'verified',
        artifact_signed: false,
        build_attested: false,
        registry_id: catalog.registry.id,
        repository: record.repository,
      }, record.id);
    }
    const assets = await resolveRepositoryReleaseAssets(source.repository, source.tag);
    const trust = {
      ...emptyTrust('repository'),
      repository: source.repository,
    };
    const releaseManifestUrl = findReleaseAssetUrl(assets, 'release-manifest.json', false);
    if (releaseManifestUrl) return this.resolveReleaseManifest(releaseManifestUrl, transactionRoot, trust);

    const platform = currentExtensionPlatform();
    const packageAsset = chooseRepositoryPackageAsset(assets, platform);
    const packagePath = path.join(transactionRoot, packageAsset.name);
    await downloadFile(packageAsset.url, packagePath, MAX_PACKAGE_BYTES);
    return {
      packagePath,
      platform: packageAsset.platform,
      trust,
    };
  }

  private async resolveReleaseManifest(
    manifestUrl: string,
    transactionRoot: string,
    trust: ExtensionInstallTrust,
    expectedExtensionId?: string,
  ): Promise<ResolvedInstallSource> {
    const release = requireValid(
      'Extension Release Manifest',
      validateExtensionReleaseManifest(await fetchJson(manifestUrl)),
    );
    if (expectedExtensionId && release.extension.id !== expectedExtensionId) {
      throw new Error(`Registry 与 Release Manifest 的扩展 ID 不一致: ${expectedExtensionId}`);
    }
    const platform = currentExtensionPlatform();
    const artifact = chooseArtifact(release.artifacts, platform);
    const artifactUrl = new URL(artifact.file, manifestUrl).toString();
    const packagePath = path.join(transactionRoot, path.basename(artifact.file));
    const downloaded = await downloadFile(artifactUrl, packagePath, MAX_PACKAGE_BYTES);
    if (downloaded.size !== artifact.size || downloaded.sha256 !== artifact.sha256) {
      throw new Error(`Release 制品摘要或大小不匹配: ${artifact.file}`);
    }
    return {
      packagePath,
      platform: artifact.platform,
      expectedSha256: artifact.sha256,
      expectedSize: artifact.size,
      expectedExtensionId: release.extension.id,
      expectedVersion: release.extension.version,
      trust: {
        ...trust,
        // Sidecar 存在不等于可信；只有完成发布者身份绑定和密码学验证后才能标记为 true。
        artifact_signed: false,
        build_attested: false,
        repository: trust.repository ?? release.source.repository,
      },
    };
  }

  private assertResolvedArtifact(resolved: ResolvedInstallSource, verified: VerifiedExtensionPackage): void {
    if (resolved.expectedSha256 && resolved.expectedSha256 !== verified.archiveSha256) throw new Error('扩展制品摘要不匹配');
    if (resolved.expectedSize !== undefined && resolved.expectedSize !== verified.archiveSize) throw new Error('扩展制品大小不匹配');
    if (resolved.expectedExtensionId && resolved.expectedExtensionId !== verified.manifest.id) throw new Error('扩展 ID 与发布清单不匹配');
    if (resolved.expectedVersion && resolved.expectedVersion !== verified.manifest.version) throw new Error('扩展版本与发布清单不匹配');
    const platform = currentExtensionPlatform();
    if (!verified.manifest.platforms.includes('any') && !verified.manifest.platforms.includes(platform)) {
      throw new Error(`扩展不支持当前平台: ${platform}`);
    }
    if (!verified.manifest.products.includes('any') && !verified.manifest.products.includes(this.productId)) {
      throw new Error(`扩展不支持当前产品: ${this.productId}`);
    }
  }

  private async writeInstallationMetadata(manifest: ExtensionManifest, preview: ExtensionInstallPreview): Promise<void> {
    const metadataPath = path.join(this.stateRoot, manifest.id, `${manifest.version}.json`);
    await fs.ensureDir(path.dirname(metadataPath));
    const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
    await fs.writeJson(temporaryPath, {
      schema: 'glimmer-cradle.extension-installation',
      schema_version: 1,
      extension_id: manifest.id,
      version: manifest.version,
      artifact_sha256: preview.artifact.sha256,
      source: preview.trust,
      installed_at: new Date().toISOString(),
    }, { spaces: 2 });
    try {
      await fs.move(temporaryPath, metadataPath, { overwrite: false });
    } finally {
      await fs.remove(temporaryPath);
    }
  }

  private async readInstallationMetadata(extensionId: string, version: string): Promise<Record<string, unknown> | null> {
    const metadataPath = path.join(this.stateRoot, extensionId, `${version}.json`);
    if (!(await fs.pathExists(metadataPath))) return null;
    return fs.readJson(metadataPath) as Promise<Record<string, unknown>>;
  }

  private async finishTransaction(transactionId: string): Promise<void> {
    this.pending.delete(transactionId);
    await fs.remove(path.join(this.transactionRoot, transactionId));
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async sweepTransactionArtifacts(): Promise<void> {
    const threshold = Date.now() - TRANSACTION_TTL_MS;
    for (const [transactionId, pending] of this.pending) {
      if (pending.createdAt >= threshold) continue;
      await this.finishTransaction(transactionId);
    }
    await fs.ensureDir(this.transactionRoot);
    const entries = await fs.readdir(this.transactionRoot).catch(() => []);
    for (const entry of entries) {
      if (this.pending.has(entry)) continue;
      await fs.remove(path.join(this.transactionRoot, entry));
    }
  }

  private async sweepStagingArtifacts(): Promise<void> {
    await fs.ensureDir(this.stagingRoot);
    const entries = await fs.readdir(this.stagingRoot).catch(() => []);
    for (const entry of entries) {
      await fs.remove(path.join(this.stagingRoot, entry));
    }
  }
}

function chooseArtifact(artifacts: ExtensionReleaseArtifact[], platform: ExtensionPlatform): ExtensionReleaseArtifact {
  const exact = artifacts.find((artifact) => artifact.platform === platform);
  const universal = artifacts.find((artifact) => artifact.platform === 'any');
  const selected = exact ?? universal;
  if (!selected) throw new Error(`Release 没有适用于当前平台的扩展包: ${platform}`);
  return selected;
}

function currentExtensionPlatform(): ExtensionPlatform {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}` as ExtensionPlatform;
}

function emptyTrust(sourceKind: ExtensionInstallSource['kind']): ExtensionInstallTrust {
  return {
    source_kind: sourceKind,
    listing_reviewed: false,
    publisher_verified: false,
    artifact_signed: false,
    build_attested: false,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await outboundUrlPolicy.fetchJson(url, {
    headers: { Accept: 'application/json' },
    maxBytes: MAX_MANIFEST_BYTES,
    maxRedirects: MAX_REDIRECTS,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`远程清单下载失败: ${response.statusCode} ${url}`);
  }
  return response.payload;
}

async function downloadFile(url: string, destination: string, maxBytes: number): Promise<{ size: number; sha256: string }> {
  const response = await outboundUrlPolicy.downloadFile(url, destination, {
    maxBytes,
    maxRedirects: MAX_REDIRECTS,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`扩展包下载失败: ${response.statusCode} ${url}`);
  }
  return { size: response.size, sha256: response.sha256 };
}

interface RepositoryReleaseAsset {
  name: string;
  url: string;
}

async function resolveRepositoryReleaseAssets(repository: string, tag: string): Promise<RepositoryReleaseAsset[]> {
  const url = new URL(repository);
  if (url.protocol !== 'https:') throw new Error('扩展仓库必须使用 HTTPS');
  const [owner, repositoryName] = url.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
  if (!owner || !repositoryName || !tag) throw new Error('仓库安装必须提供仓库地址和不可变 tag');

  if (url.hostname === 'github.com') {
    const release = await fetchJson(`https://api.github.com/repos/${owner}/${repositoryName}/releases/tags/${encodeURIComponent(tag)}`) as Record<string, unknown>;
    return parseReleaseAssets(release.assets);
  }
  if (url.hostname === 'gitlab.com') {
    const project = encodeURIComponent(`${owner}/${repositoryName}`);
    const release = await fetchJson(`https://gitlab.com/api/v4/projects/${project}/releases/${encodeURIComponent(tag)}`) as Record<string, unknown>;
    const assets = release.assets as { links?: unknown } | undefined;
    return parseReleaseAssets(assets?.links);
  }
  const release = await fetchJson(`${url.origin}/api/v1/repos/${owner}/${repositoryName}/releases/tags/${encodeURIComponent(tag)}`) as Record<string, unknown>;
  return parseReleaseAssets(release.assets);
}

function parseReleaseAssets(rawAssets: unknown): RepositoryReleaseAsset[] {
  if (!Array.isArray(rawAssets)) throw new Error('仓库 Release 不包含资产列表');
  const assets: RepositoryReleaseAsset[] = [];
  for (const raw of rawAssets) {
    if (!raw || typeof raw !== 'object') continue;
    const asset = raw as Record<string, unknown>;
    if (typeof asset.name !== 'string') continue;
    const url = typeof asset.browser_download_url === 'string'
      ? asset.browser_download_url
      : typeof asset.direct_asset_url === 'string'
        ? asset.direct_asset_url
        : typeof asset.url === 'string'
          ? asset.url
          : '';
    if (url) assets.push({ name: asset.name, url });
  }
  return assets;
}

function findReleaseAssetUrl(
  assets: RepositoryReleaseAsset[],
  expectedName: string,
  required = true,
): string | undefined {
  const asset = assets.find((candidate) => candidate.name === expectedName);
  if (asset) return asset.url;
  if (required) throw new Error(`仓库 Release 缺少 ${expectedName}`);
  return undefined;
}

function chooseRepositoryPackageAsset(
  assets: RepositoryReleaseAsset[],
  platform: ExtensionPlatform,
): RepositoryReleaseAsset & { platform: ExtensionPlatform } {
  const exact = assets.filter((asset) => asset.name.endsWith(`-${platform}.gcex`));
  const universal = assets.filter((asset) => asset.name.endsWith('-any.gcex'));
  const candidates = exact.length > 0 ? exact : universal;
  if (candidates.length === 0) {
    throw new Error(`仓库 Release 既没有 release-manifest.json，也没有适用于 ${platform} 的规范命名 .gcex`);
  }
  if (candidates.length > 1) {
    throw new Error(`仓库 Release 中适用于 ${platform} 的 .gcex 不唯一，请提供 release-manifest.json`);
  }
  return { ...candidates[0], platform: exact.length > 0 ? platform : 'any' };
}

function assertSameStringSet(expected: string[], actual: string[], message: string): void {
  const left = [...new Set(expected)].sort();
  const right = [...new Set(actual)].sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) throw new Error(message);
}

function requireValid<T>(label: string, result: ExtensionContractValidation<T>): T {
  if (!result.ok || result.data === undefined) {
    throw new Error(`${label} 契约校验失败: ${result.errors.join('; ')}`);
  }
  return result.data;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
