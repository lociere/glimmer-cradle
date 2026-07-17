import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Unzip, UnzipInflate, zipSync, type Zippable } from 'fflate';
import YAML from 'yaml';
import {
  EXTENSION_PACKAGE_MEDIA_TYPE,
  isSafeExtensionPackagePath,
  validateExtensionManifest,
  validateExtensionPackageChecksums,
  validateExtensionPackageEnvelope,
  validateExtensionReleaseManifest,
  type ExtensionContractValidation,
  type ExtensionManifest,
  type ExtensionPackageChecksums,
  type ExtensionPackageEnvelope,
  type ExtensionPlatform,
  type ExtensionReleaseManifest,
} from '@glimmer-cradle/protocol';
import {
  type ExtensionReleaseChannel,
} from './contracts';

const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20_000;
const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');

export interface GcexPackageConfig {
  include: string[];
  sbom?: string;
}

export interface BuildGcexPackageOptions {
  extensionRoot: string;
  outputDirectory: string;
  platform: ExtensionPlatform;
  sourceRevision: string;
  sourceTag?: string;
  channel?: ExtensionReleaseChannel;
  packageConfigPath?: string;
}

export interface BuiltGcexPackage {
  packagePath: string;
  packageFileName: string;
  manifest: ExtensionManifest;
  platform: ExtensionPlatform;
  archiveSha256: string;
  archiveSize: number;
  sourceRevision: string;
  sourceTag?: string;
}

export interface BuildExtensionReleaseManifestOptions {
  packages: BuiltGcexPackage[];
  outputDirectory: string;
  channel?: ExtensionReleaseChannel;
  fileName?: string;
}

export interface BuiltExtensionReleaseManifest {
  manifestPath: string;
  manifest: ExtensionReleaseManifest;
}

export interface VerifyGcexPackageOptions {
  maxArchiveBytes?: number;
  maxExpandedBytes?: number;
  maxFiles?: number;
}

export interface VerifiedGcexPackage {
  manifest: ExtensionManifest;
  envelope: ExtensionPackageEnvelope;
  checksums: ExtensionPackageChecksums;
  files: Map<string, Uint8Array>;
  archiveSha256: string;
  archiveSize: number;
}

export async function buildGcexPackage(options: BuildGcexPackageOptions): Promise<BuiltGcexPackage> {
  const extensionRoot = path.resolve(options.extensionRoot);
  const manifestPath = path.join(extensionRoot, 'extension-manifest.yaml');
  const manifest = requireValid(
    'extension-manifest.yaml',
    validateExtensionManifest(YAML.parse(await fs.readFile(manifestPath, 'utf8'))),
  );
  assertPlatformCompatibility(manifest, options.platform);
  if (!/^[a-fA-F0-9]{7,64}$/.test(options.sourceRevision)) {
    throw new Error('sourceRevision 必须是 7 到 64 位十六进制提交摘要');
  }

  const packageConfig = await readPackageConfig(
    options.packageConfigPath ?? path.join(extensionRoot, 'gcex.package.yaml'),
  );
  const payloadFiles = await collectPayloadFiles(extensionRoot, packageConfig.include);
  payloadFiles.set('extension/extension-manifest.yaml', new Uint8Array(await fs.readFile(manifestPath)));

  const sbomPath = 'META-INF/sbom.spdx.json';
  if (packageConfig.sbom) {
    const sourcePath = resolveInsideRoot(extensionRoot, packageConfig.sbom);
    payloadFiles.set(sbomPath, new Uint8Array(await fs.readFile(sourcePath)));
  } else {
    payloadFiles.set(sbomPath, encodeJson(await createSpdxSbom(extensionRoot, manifest, options.sourceRevision)));
  }

  const checksumFiles = [...payloadFiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, bytes]) => ({ path: filePath, size: bytes.byteLength, sha256: sha256(bytes) }));
  const checksums = requireValid('checksums.json', validateExtensionPackageChecksums({
    schema: 'glimmer-cradle.extension-checksums',
    algorithm: 'sha256',
    files: checksumFiles,
  }));
  const envelope = requireValid('gcex.json', validateExtensionPackageEnvelope({
    schema: 'glimmer-cradle.extension-package',
    format_version: 1,
    media_type: EXTENSION_PACKAGE_MEDIA_TYPE,
    payload_root: 'extension/',
    extension_manifest: 'extension/extension-manifest.yaml',
    integrity_manifest: 'META-INF/checksums.json',
    sbom: sbomPath,
  }));

  const archiveFiles = new Map(payloadFiles);
  archiveFiles.set('META-INF/gcex.json', encodeJson(envelope));
  archiveFiles.set('META-INF/checksums.json', encodeJson(checksums));
  const archive = zipSync(toZippable(archiveFiles), { level: 9 });

  await fs.mkdir(options.outputDirectory, { recursive: true });
  const packageFileName = `${manifest.id}-${manifest.version}-${options.platform}.gcex`;
  const packagePath = path.join(options.outputDirectory, packageFileName);
  await fs.writeFile(packagePath, archive);

  return {
    packagePath,
    packageFileName,
    manifest,
    platform: options.platform,
    archiveSha256: sha256(archive),
    archiveSize: archive.byteLength,
    sourceRevision: options.sourceRevision.toLowerCase(),
    ...(options.sourceTag ? { sourceTag: options.sourceTag } : {}),
  };
}

export async function buildExtensionReleaseManifest(
  options: BuildExtensionReleaseManifestOptions,
): Promise<BuiltExtensionReleaseManifest> {
  if (options.packages.length === 0) throw new Error('Release Manifest 至少需要一个 .gcex 制品');
  const [primary, ...rest] = options.packages;
  const platforms = new Set<ExtensionPlatform>([primary.platform]);
  for (const built of rest) {
    if (
      built.manifest.id !== primary.manifest.id
      || built.manifest.version !== primary.manifest.version
      || built.manifest.publisher !== primary.manifest.publisher
      || built.manifest.repository !== primary.manifest.repository
      || built.sourceRevision !== primary.sourceRevision
      || built.sourceTag !== primary.sourceTag
    ) {
      throw new Error('Release Manifest 只能聚合同一扩展、版本、源码修订和 tag 的制品');
    }
    if (platforms.has(built.platform)) throw new Error(`Release Manifest 包含重复平台: ${built.platform}`);
    platforms.add(built.platform);
  }

  const releaseManifest = requireValid('release-manifest.json', validateExtensionReleaseManifest({
    schema: 'glimmer-cradle.extension-release',
    schema_version: 1,
    extension: {
      id: primary.manifest.id,
      version: primary.manifest.version,
      publisher: primary.manifest.publisher,
    },
    channel: options.channel ?? 'stable',
    source: {
      repository: primary.manifest.repository,
      revision: primary.sourceRevision,
      ...(primary.sourceTag ? { tag: primary.sourceTag } : {}),
    },
    artifacts: [...options.packages]
      .sort((left, right) => left.platform.localeCompare(right.platform))
      .map((built) => ({
      platform: built.platform,
      file: built.packageFileName,
      media_type: EXTENSION_PACKAGE_MEDIA_TYPE,
      size: built.archiveSize,
      sha256: built.archiveSha256,
    })),
  }));
  const fileName = options.fileName ?? 'release-manifest.json';
  if (path.basename(fileName) !== fileName || fileName === '.' || fileName === '..') {
    throw new Error('Release Manifest 文件名不能包含路径');
  }
  await fs.mkdir(options.outputDirectory, { recursive: true });
  const manifestPath = path.join(options.outputDirectory, fileName);
  await fs.writeFile(manifestPath, encodeJson(releaseManifest));
  return { manifestPath, manifest: releaseManifest };
}

export async function verifyGcexPackage(
  packagePath: string,
  options: VerifyGcexPackageOptions = {},
): Promise<VerifiedGcexPackage> {
  const archive = new Uint8Array(await fs.readFile(packagePath));
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  if (archive.byteLength > maxArchiveBytes) throw new Error(`.gcex 超过最大允许大小 ${maxArchiveBytes}`);

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxExpandedBytes = options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES;
  const files = unzipWithLimits(archive, maxFiles, maxExpandedBytes);
  for (const [filePath] of files) {
    if (!isSafeExtensionPackagePath(filePath)) throw new Error(`.gcex 包含非法路径: ${filePath}`);
    if (!filePath.startsWith('extension/') && !filePath.startsWith('META-INF/')) {
      throw new Error(`.gcex 包含未声明的顶层路径: ${filePath}`);
    }
  }

  const envelope = requireValid(
    'META-INF/gcex.json',
    validateExtensionPackageEnvelope(parseJsonFile(files, 'META-INF/gcex.json')),
  );
  const checksums = requireValid(
    envelope.integrity_manifest,
    validateExtensionPackageChecksums(parseJsonFile(files, envelope.integrity_manifest)),
  );
  const checksumPaths = new Set<string>();
  for (const entry of checksums.files) {
    if (checksumPaths.has(entry.path)) throw new Error(`checksums.json 包含重复路径: ${entry.path}`);
    checksumPaths.add(entry.path);
    const bytes = files.get(entry.path);
    if (!bytes) throw new Error(`checksums.json 引用了缺失文件: ${entry.path}`);
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error(`.gcex 文件完整性校验失败: ${entry.path}`);
    }
  }
  for (const filePath of files.keys()) {
    if ((filePath.startsWith('extension/') || filePath === envelope.sbom) && !checksumPaths.has(filePath)) {
      throw new Error(`.gcex 文件未纳入完整性清单: ${filePath}`);
    }
  }

  const manifestBytes = files.get(envelope.extension_manifest);
  if (!manifestBytes) throw new Error(`.gcex 缺少扩展清单: ${envelope.extension_manifest}`);
  const manifest = requireValid(
    envelope.extension_manifest,
    validateExtensionManifest(YAML.parse(new TextDecoder().decode(manifestBytes))),
  );
  validateSpdxSbom(parseJsonFile(files, envelope.sbom), manifest);
  return {
    manifest,
    envelope,
    checksums,
    files,
    archiveSha256: sha256(archive),
    archiveSize: archive.byteLength,
  };
}

export async function extractVerifiedGcexPackage(
  verified: VerifiedGcexPackage,
  destination: string,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  for (const [archivePath, bytes] of verified.files) {
    if (!archivePath.startsWith(verified.envelope.payload_root)) continue;
    const relativePath = archivePath.slice(verified.envelope.payload_root.length);
    if (!relativePath || !isSafeExtensionPackagePath(relativePath)) throw new Error(`非法扩展 payload 路径: ${archivePath}`);
    const targetPath = path.resolve(destination, ...relativePath.split('/'));
    if (!isPathInside(destination, targetPath)) throw new Error(`扩展 payload 越过安装目录: ${archivePath}`);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, bytes);
  }
}

async function readPackageConfig(configPath: string): Promise<GcexPackageConfig> {
  const raw = YAML.parse(await fs.readFile(configPath, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('gcex.package.yaml 必须是对象');
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.include) || data.include.length === 0 || data.include.some((item) => typeof item !== 'string')) {
    throw new Error('gcex.package.yaml 必须声明非空 include 路径数组');
  }
  if (data.sbom !== undefined && typeof data.sbom !== 'string') throw new Error('gcex.package.yaml 的 sbom 必须是路径');
  return { include: data.include as string[], ...(data.sbom ? { sbom: data.sbom as string } : {}) };
}

async function collectPayloadFiles(root: string, includes: string[]): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const include of [...new Set(includes)].sort()) {
    if (!isSafeExtensionPackagePath(include)) throw new Error(`非法打包路径: ${include}`);
    if (include === 'extension-manifest.yaml' || include === 'gcex.package.yaml') continue;
    const sourcePath = resolveInsideRoot(root, include);
    const stat = await fs.lstat(sourcePath);
    if (stat.isSymbolicLink()) throw new Error(`打包路径不能是符号链接: ${include}`);
    if (stat.isDirectory()) {
      await collectDirectory(root, sourcePath, files);
    } else if (stat.isFile()) {
      files.set(`extension/${toPosix(path.relative(root, sourcePath))}`, new Uint8Array(await fs.readFile(sourcePath)));
    } else {
      throw new Error(`不支持的打包对象: ${include}`);
    }
  }
  return files;
}

async function collectDirectory(root: string, directory: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`打包目录不能包含符号链接: ${path.relative(root, sourcePath)}`);
    if (entry.isDirectory()) await collectDirectory(root, sourcePath, files);
    else if (entry.isFile()) files.set(`extension/${toPosix(path.relative(root, sourcePath))}`, new Uint8Array(await fs.readFile(sourcePath)));
    else throw new Error(`不支持的打包对象: ${path.relative(root, sourcePath)}`);
  }
}

function toZippable(files: Map<string, Uint8Array>): Zippable {
  const output: Zippable = {};
  for (const [filePath, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    output[filePath] = [bytes, { level: 9, mtime: FIXED_ZIP_DATE }];
  }
  return output;
}

function resolveInsideRoot(root: string, relativePath: string): string {
  if (!isSafeExtensionPackagePath(relativePath)) throw new Error(`非法相对路径: ${relativePath}`);
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (!isPathInside(root, resolved)) throw new Error(`路径越过扩展根目录: ${relativePath}`);
  return resolved;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function parseJsonFile(files: Map<string, Uint8Array>, filePath: string): unknown {
  const bytes = files.get(filePath);
  if (!bytes) throw new Error(`.gcex 缺少文件: ${filePath}`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function requireValid<T>(label: string, result: ExtensionContractValidation<T>): T {
  if (!result.ok || result.data === undefined) {
    throw new Error(`${label} 契约校验失败: ${result.errors.join('; ')}`);
  }
  return result.data;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function unzipWithLimits(
  archive: Uint8Array,
  maxFiles: number,
  maxExpandedBytes: number,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const discoveredPaths = new Set<string>();
  let discoveredFiles = 0;
  let declaredExpandedBytes = 0;
  let actualExpandedBytes = 0;
  let failure: unknown;
  const unzipper = new Unzip((file) => {
    if (failure) {
      file.terminate();
      return;
    }
    try {
      discoveredFiles += 1;
      if (discoveredFiles > maxFiles) throw new Error(`.gcex 文件数量超过上限 ${maxFiles}`);
      if (!isSafeExtensionPackagePath(file.name)) throw new Error(`.gcex 包含非法路径: ${file.name}`);
      if (!file.name.startsWith('extension/') && !file.name.startsWith('META-INF/')) {
        throw new Error(`.gcex 包含未声明的顶层路径: ${file.name}`);
      }
      if (discoveredPaths.has(file.name)) throw new Error(`.gcex 包含重复路径: ${file.name}`);
      discoveredPaths.add(file.name);
      if (file.originalSize !== undefined) {
        declaredExpandedBytes += file.originalSize;
        if (declaredExpandedBytes > maxExpandedBytes) throw new Error('.gcex 解压后内容超过允许上限');
      }

      const chunks: Uint8Array[] = [];
      let fileSize = 0;
      file.ondata = (error, chunk, final) => {
        if (failure) return;
        if (error) {
          failure = error;
          return;
        }
        actualExpandedBytes += chunk.byteLength;
        fileSize += chunk.byteLength;
        if (actualExpandedBytes > maxExpandedBytes) {
          failure = new Error('.gcex 解压后内容超过允许上限');
          file.terminate();
          return;
        }
        chunks.push(chunk);
        if (final) files.set(file.name, concatBytes(chunks, fileSize));
      };
      file.start();
    } catch (error) {
      failure = error;
      file.terminate();
    }
  });
  unzipper.register(UnzipInflate);
  try {
    unzipper.push(archive, true);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  if (files.size !== discoveredFiles) throw new Error('.gcex 解压未完整结束');
  return files;
}

function concatBytes(chunks: Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function assertPlatformCompatibility(manifest: ExtensionManifest, platform: ExtensionPlatform): void {
  if (!manifest.platforms.includes('any') && !manifest.platforms.includes(platform)) {
    throw new Error(`扩展 ${manifest.id} 未声明平台 ${platform}`);
  }
}

async function createSpdxSbom(
  extensionRoot: string,
  manifest: ExtensionManifest,
  sourceRevision: string,
): Promise<Record<string, unknown>> {
  const packages: Record<string, unknown>[] = [{
    SPDXID: 'SPDXRef-Extension',
    name: manifest.id,
    versionInfo: manifest.version,
    downloadLocation: manifest.repository,
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: manifest.license || 'NOASSERTION',
    supplier: `Organization: ${manifest.publisher}`,
  }];
  const relationships: Record<string, unknown>[] = [{
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: 'SPDXRef-Extension',
  }];
  const packageJsonPath = path.join(extensionRoot, 'package.json');
  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const dependencies = packageJson.dependencies && typeof packageJson.dependencies === 'object'
      ? packageJson.dependencies as Record<string, unknown>
      : {};
    for (const [dependencyName, dependencyVersion] of Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right))) {
      const dependencyId = `SPDXRef-Dependency-${dependencyName.replace(/[^A-Za-z0-9.-]/g, '-')}`;
      packages.push({
        SPDXID: dependencyId,
        name: dependencyName,
        versionInfo: String(dependencyVersion),
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: 'NOASSERTION',
      });
      relationships.push({
        spdxElementId: 'SPDXRef-Extension',
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: dependencyId,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${manifest.id}-${manifest.version}`,
    documentNamespace: `https://glimmer-cradle.dev/spdx/${manifest.id}/${manifest.version}/${sourceRevision.toLowerCase()}`,
    creationInfo: {
      created: '1980-01-01T00:00:00Z',
      creators: ['Tool: @glimmer-cradle/extension-sdk'],
    },
    packages,
    relationships,
  };
}

function validateSpdxSbom(value: unknown, manifest: ExtensionManifest): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SBOM 必须是 SPDX JSON 对象');
  const sbom = value as Record<string, unknown>;
  if (sbom.spdxVersion !== 'SPDX-2.3' || sbom.dataLicense !== 'CC0-1.0' || !Array.isArray(sbom.packages)) {
    throw new Error('SBOM 不符合 SPDX 2.3 JSON 基本结构');
  }
  const describesExtension = sbom.packages.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const packageRecord = item as Record<string, unknown>;
    return packageRecord.name === manifest.id && packageRecord.versionInfo === manifest.version;
  });
  if (!describesExtension) throw new Error('SBOM 未描述当前扩展 ID 与版本');
}
