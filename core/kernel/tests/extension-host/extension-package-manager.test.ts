import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { EXTENSION_PACKAGE_MEDIA_TYPE } from '@glimmer-cradle/protocol';
import { ExtensionPackageManager } from '../../src/infrastructure/extension-installation/extension-package-manager';

const temporaryRoots: string[] = [];
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;

afterEach(async () => {
  if (originalDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = originalDataRoot;
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('ExtensionPackageManager', () => {
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-package-manager-redirect-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'http://downloads.example.com/release-manifest.json' } }),
    );
    const manager = new ExtensionPackageManager(path.join(root, 'data', 'packages', 'extensions'));
    try {
      await expect(manager.prepareInstall({
        kind: 'release_manifest',
        url: 'https://downloads.example.com/release-manifest.json',
      })).rejects.toThrow('必须使用 HTTPS');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('installs a canonical .gcex asset from an exact repository release without a release manifest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-package-manager-repository-'));
    temporaryRoots.push(root);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const packageBytes = await fs.readFile(await createPackage(root));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/community/example/releases/tags/v1.0.0') {
        return new Response(JSON.stringify({
          assets: [{
            name: 'community.example-1.0.0-any.gcex',
            browser_download_url: 'https://github.com/community/example/releases/download/v1.0.0/community.example-1.0.0-any.gcex',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/community.example-1.0.0-any.gcex')) {
        return new Response(packageBytes, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
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
      fetchMock.mockRestore();
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
