import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Unzip, UnzipInflate } from 'fflate';
import YAML from 'yaml';
import {
  isSafeExtensionPackagePath,
  validateExtensionManifest,
  validateExtensionPackageChecksums,
  validateExtensionPackageEnvelope,
  type ExtensionContractValidation,
  type ExtensionManifest,
  type ExtensionPackageChecksums,
  type ExtensionPackageEnvelope,
} from '@glimmer-cradle/protocol';

const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20_000;

export interface VerifyExtensionPackageOptions {
  maxArchiveBytes?: number;
  maxExpandedBytes?: number;
  maxFiles?: number;
}

export interface VerifiedExtensionPackage {
  manifest: ExtensionManifest;
  envelope: ExtensionPackageEnvelope;
  checksums: ExtensionPackageChecksums;
  files: Map<string, Uint8Array>;
  archiveSha256: string;
  archiveSize: number;
}

/** Kernel trust boundary: validates an untrusted archive without executing extension code. */
export async function verifyExtensionPackage(
  packagePath: string,
  options: VerifyExtensionPackageOptions = {},
): Promise<VerifiedExtensionPackage> {
  const archive = new Uint8Array(await fs.readFile(packagePath));
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  if (archive.byteLength > maxArchiveBytes) throw new Error(`.gcex 超过最大允许大小 ${maxArchiveBytes}`);

  const files = unzipWithLimits(
    archive,
    options.maxFiles ?? DEFAULT_MAX_FILES,
    options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
  );
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

export async function extractVerifiedExtensionPackage(
  verified: VerifiedExtensionPackage,
  destination: string,
): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  for (const [archivePath, bytes] of verified.files) {
    if (!archivePath.startsWith(verified.envelope.payload_root)) continue;
    const relativePath = archivePath.slice(verified.envelope.payload_root.length);
    if (!relativePath || !isSafeExtensionPackagePath(relativePath)) {
      throw new Error(`非法扩展 payload 路径: ${archivePath}`);
    }
    const targetPath = path.resolve(destination, ...relativePath.split('/'));
    if (!isPathInside(destination, targetPath)) throw new Error(`扩展 payload 越过安装目录: ${archivePath}`);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, bytes);
  }
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

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
