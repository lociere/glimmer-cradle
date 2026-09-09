import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { EXTENSION_PACKAGE_MEDIA_TYPE } from '@glimmer-cradle/extension-sdk';
import { ExtensionPackageManager } from '../../src/adapters/extension-installation/extension-package-manager';
import { OutboundUrlPolicy } from '../../src/adapters/extension-installation/outbound-url-policy';

const temporaryRoots: string[] = [];
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
const suppliedCandidateTest = process.env.GLIMMER_EXTENSION_PACKAGE_CANDIDATE ? it : it.skip;
const suppliedReleaseCandidateTest = process.env.GLIMMER_EXTENSION_PACKAGE_CANDIDATE
  && process.env.GLIMMER_EXTENSION_RELEASE_MANIFEST ? it : it.skip;

afterEach(async () => {
  if (originalDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = originalDataRoot;
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('ExtensionPackageManager', () => {
  suppliedCandidateTest('installs a supplied fixed extension candidate through the product package transaction', async () => {
    const packagePath = path.resolve(process.env.GLIMMER_EXTENSION_PACKAGE_CANDIDATE!);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-package-candidate-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const extensionRoot = path.join(root, 'data', 'packages', 'extensions');
    const manager = new ExtensionPackageManager(extensionRoot, 'personal-server');

    try {
      const denied = await manager.prepareInstall({ kind: 'file', path: packagePath });
      expect(denied.extension.id).toBe(process.env.GLIMMER_EXTENSION_EXPECTED_ID);
      expect(denied.extension.version).toBe(process.env.GLIMMER_EXTENSION_EXPECTED_VERSION);
      expect(denied.extension.products).toContain('personal-server');
      expect(denied.extension.permissions.length).toBeGreaterThan(0);
      await expect(manager.commitInstall(denied.transaction_id, [])).rejects.toThrow('权限');
      await manager.cancelInstall(denied.transaction_id);

      const target = path.join(extensionRoot, denied.extension.id, denied.extension.version);
      expect(await fs.pathExists(target)).toBe(false);
      const preview = await manager.prepareInstall({ kind: 'file', path: packagePath });
      const installed = await manager.commitInstall(preview.transaction_id, preview.extension.permissions);
      expect(installed.already_installed).toBe(false);
      expect(await fs.pathExists(path.join(installed.installed_path, 'dist', 'index.js'))).toBe(true);

      const duplicatePreview = await manager.prepareInstall({ kind: 'file', path: packagePath });
      const duplicate = await manager.commitInstall(duplicatePreview.transaction_id, duplicatePreview.extension.permissions);
      expect(duplicate.already_installed).toBe(true);

      await manager.uninstall(installed.extension_id, installed.version, false);
      expect(await fs.pathExists(installed.installed_path)).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  suppliedReleaseCandidateTest('installs a supplied fixed extension candidate through its release manifest', async () => {
    const packagePath = path.resolve(process.env.GLIMMER_EXTENSION_PACKAGE_CANDIDATE!);
    const releaseManifestPath = path.resolve(process.env.GLIMMER_EXTENSION_RELEASE_MANIFEST!);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-release-candidate-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const releaseRoot = path.dirname(releaseManifestPath);
    const policy = new OutboundUrlPolicy({
      lookupAll: async () => ['93.184.216.34'],
      requester: async (target) => {
        const fileName = path.basename(target.url.pathname);
        const sourcePath = fileName === 'release-manifest.json'
          ? releaseManifestPath
          : path.join(releaseRoot, fileName);
        if (!(await fs.pathExists(sourcePath))) throw new Error(`Unexpected release asset: ${target.url}`);
        return {
          statusCode: 200,
          headers: {},
          body: bytesFrom(await fs.readFile(sourcePath)),
        };
      },
    });
    const extensionRoot = path.join(root, 'data', 'packages', 'extensions');
    const manager = new ExtensionPackageManager(extensionRoot, 'personal-server', policy);

    try {
      const preview = await manager.prepareInstall({
        kind: 'release_manifest',
        url: 'https://downloads.example.com/release-manifest.json',
      });
      expect(preview.extension.id).toBe(process.env.GLIMMER_EXTENSION_EXPECTED_ID);
      expect(preview.extension.version).toBe(process.env.GLIMMER_EXTENSION_EXPECTED_VERSION);
      expect(preview.trust.source_kind).toBe('release_manifest');
      expect(preview.artifact.sha256).toBe(sha256(await fs.readFile(packagePath)));
      const installed = await manager.commitInstall(preview.transaction_id, preview.extension.permissions);
      expect(await fs.pathExists(path.join(installed.installed_path, 'dist', 'index.js'))).toBe(true);
      await manager.uninstall(installed.extension_id, installed.version, false);
    } finally {
      manager.dispose();
    }
  });

  suppliedReleaseCandidateTest('rejects a supplied release manifest with a mismatched digest without residue', async () => {
    const packagePath = path.resolve(process.env.GLIMMER_EXTENSION_PACKAGE_CANDIDATE!);
    const releaseManifestPath = path.resolve(process.env.GLIMMER_EXTENSION_RELEASE_MANIFEST!);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-release-mismatch-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const release = await fs.readJson(releaseManifestPath) as {
      artifacts: Array<Record<string, unknown>>;
    };
    release.artifacts = release.artifacts.map((artifact) => ({ ...artifact, sha256: '0'.repeat(64) }));
    const policy = new OutboundUrlPolicy({
      lookupAll: async () => ['93.184.216.34'],
      requester: async (target) => ({
        statusCode: 200,
        headers: {},
        body: target.url.pathname.endsWith('/release-manifest.json')
          ? bytesFrom(new TextEncoder().encode(JSON.stringify(release)))
          : bytesFrom(await fs.readFile(packagePath)),
      }),
    });
    const extensionRoot = path.join(root, 'data', 'packages', 'extensions');
    const manager = new ExtensionPackageManager(extensionRoot, 'personal-server', policy);

    try {
      await expect(manager.prepareInstall({
        kind: 'release_manifest',
        url: 'https://downloads.example.com/release-manifest.json',
      })).rejects.toThrow('摘要或大小不匹配');
      const transactionRoot = path.join(root, 'data', 'cache', 'extensions', 'package-manager', 'transactions');
      expect(await fs.readdir(transactionRoot)).toEqual([]);
      expect(await fs.pathExists(path.join(extensionRoot, process.env.GLIMMER_EXTENSION_EXPECTED_ID!, process.env.GLIMMER_EXTENSION_EXPECTED_VERSION!))).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it('requires exact permission approval before atomic installation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-package-manager-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const packagePath = await createPackage(root);
    const extensionRoot = path.join(root, 'data', 'packages', 'extensions');
    const manager = new ExtensionPackageManager(extensionRoot);

    const rejected = await manager.prepareInstall({ kind: 'file', path: packagePath });
    await expect(manager.commitInstall(rejected.transaction_id, [])).rejects.toThrow('权限');
    await manager.cancelInstall(rejected.transaction_id);

    const preview = await manager.prepareInstall({ kind: 'file', path: packagePath });
    expect(preview.extension.id).toBe('community.example');
    expect(preview.trust.listing_reviewed).toBe(false);
    const result = await manager.commitInstall(preview.transaction_id, ['CONFIG_READ_SELF']);
    expect(result.already_installed).toBe(false);
    expect(await fs.pathExists(path.join(result.installed_path, 'dist', 'index.js'))).toBe(true);
    expect(await fs.pathExists(path.join(result.installed_path, 'extension-manifest.yaml'))).toBe(true);

    const duplicatePreview = await manager.prepareInstall({ kind: 'file', path: packagePath });
    const duplicate = await manager.commitInstall(duplicatePreview.transaction_id, ['CONFIG_READ_SELF']);
    expect(duplicate.already_installed).toBe(true);

    await expect(manager.uninstall('community.example', '1.0.0', true)).rejects.toThrow('当前激活版本');
    await expect(manager.uninstall('community.example', '../invalid', false)).rejects.toThrow('无效的扩展卸载');
    await manager.uninstall('community.example', '1.0.0', false);
    expect(await fs.pathExists(result.installed_path)).toBe(false);
  });

  it('rejects a remote source before following an HTTPS downgrade redirect', async () => {
    const requester = vi.fn(async (): Promise<{
      statusCode: number;
      headers: Record<string, string>;
      body: AsyncIterable<Uint8Array>;
    }> => ({
      statusCode: 302,
      headers: { location: 'http://downloads.example.com/release-manifest.json' },
      body: bytesFromText('redirect'),
    }));
    const policy = new OutboundUrlPolicy({
      lookupAll: async () => ['93.184.216.34'],
      requester,
    });
    await expect(policy.fetchJson('https://downloads.example.com/release-manifest.json', {
      maxBytes: 1024,
      maxRedirects: 2,
    })).rejects.toThrow('必须使用 HTTPS');
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it('installs a canonical .gcex asset from an exact repository release without a release manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-package-manager-repository-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const packageBytes = await fs.readFile(await createPackage(root));
    const fetchJsonMock = vi.spyOn(OutboundUrlPolicy.prototype, 'fetchJson').mockImplementation(async (url) => {
      if (url === 'https://api.github.com/repos/community/example/releases/tags/v1.0.0') {
        return {
          statusCode: 200,
          payload: {
          assets: [{
            name: 'community.example-1.0.0-any.gcex',
            browser_download_url: 'https://github.com/community/example/releases/download/v1.0.0/community.example-1.0.0-any.gcex',
          }],
          },
          finalUrl: url,
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const downloadMock = vi.spyOn(OutboundUrlPolicy.prototype, 'downloadFile').mockImplementation(async (url, destination) => {
      if (!url.endsWith('/community.example-1.0.0-any.gcex')) throw new Error(`Unexpected URL: ${url}`);
      await fs.writeFile(destination, packageBytes);
      return {
        statusCode: 200,
        size: packageBytes.byteLength,
        sha256: sha256(packageBytes),
        finalUrl: url,
      };
    });
    const manager = new ExtensionPackageManager(path.join(root, 'data', 'packages', 'extensions'));
    try {
      const preview = await manager.prepareInstall({
        kind: 'repository',
        repository: 'https://github.com/community/example',
        tag: 'v1.0.0',
      });
      expect(preview.extension.id).toBe('community.example');
      expect(preview.trust.repository).toBe('https://github.com/community/example');
      expect(preview.trust.listing_reviewed).toBe(false);
      await manager.cancelInstall(preview.transaction_id);
    } finally {
      fetchJsonMock.mockRestore();
      downloadMock.mockRestore();
    }
  });
});

async function createPackage(root: string): Promise<string> {
  const manifest = [
    'id: community.example',
    'name: Example',
    'version: 1.0.0',
    'publisher: community',
    'license: MIT',
    'repository: https://example.com/community/example',
    'platforms: [any]',
    'main: dist/index.js',
    'permissions: [CONFIG_READ_SELF]',
  ].join('\n');
  const payload = new Map<string, Uint8Array>([
    ['extension/extension-manifest.yaml', encode(manifest)],
    ['extension/dist/index.js', encode('module.exports = {};\n')],
    ['META-INF/sbom.spdx.json', encode(JSON.stringify({
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      packages: [{ name: 'community.example', versionInfo: '1.0.0' }],
    }))],
  ]);
  const checksums = {
    schema: 'glimmer-cradle.extension-checksums',
    algorithm: 'sha256',
    files: [...payload].map(([filePath, bytes]) => ({
      path: filePath,
      size: bytes.byteLength,
      sha256: sha256(bytes),
    })),
  };
  const envelope = {
    schema: 'glimmer-cradle.extension-package',
    format_version: 1,
    media_type: EXTENSION_PACKAGE_MEDIA_TYPE,
    payload_root: 'extension/',
    extension_manifest: 'extension/extension-manifest.yaml',
    integrity_manifest: 'META-INF/checksums.json',
    sbom: 'META-INF/sbom.spdx.json',
  };
  const archive = zipSync(Object.fromEntries([
    ...payload,
    ['META-INF/gcex.json', encode(JSON.stringify(envelope))],
    ['META-INF/checksums.json', encode(JSON.stringify(checksums))],
  ]));
  const packagePath = path.join(root, 'community.example-1.0.0-any.gcex');
  await fs.writeFile(packagePath, archive);
  return packagePath;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function* bytesFromText(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}

async function* bytesFrom(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield value;
}
