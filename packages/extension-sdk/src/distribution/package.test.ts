import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import {
  buildExtensionReleaseManifest,
  buildGcexPackage,
  extractVerifiedGcexPackage,
  verifyGcexPackage,
} from './package';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('.gcex distribution package', () => {
  it('builds, verifies and extracts a deterministic package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gcex-package-'));
    temporaryRoots.push(root);
    const extensionRoot = path.join(root, 'extension');
    const outputRoot = path.join(root, 'release');
    await fs.mkdir(path.join(extensionRoot, 'dist'), { recursive: true });
    await fs.writeFile(path.join(extensionRoot, 'extension-manifest.yaml'), [
      'id: community.example',
      'name: Example',
      'version: 1.0.0',
      'publisher: community',
      'license: MIT',
      'repository: https://example.com/community/example',
      'platforms: [any]',
      'main: dist/index.js',
    ].join('\n'));
    await fs.writeFile(path.join(extensionRoot, 'gcex.package.yaml'), 'include:\n  - dist\n');
    await fs.writeFile(path.join(extensionRoot, 'dist', 'index.js'), 'module.exports = {};\n');

    const buildOptions = {
      extensionRoot,
      outputDirectory: outputRoot,
      platform: 'any' as const,
      sourceRevision: '1234567890abcdef1234567890abcdef12345678',
      sourceTag: 'v1.0.0',
    };
    const first = await buildGcexPackage(buildOptions);
    const firstBytes = await fs.readFile(first.packagePath);
    await expect(fs.access(path.join(outputRoot, 'release-manifest.json'))).rejects.toThrow();
    const second = await buildGcexPackage(buildOptions);
    expect(await fs.readFile(second.packagePath)).toEqual(firstBytes);

    const release = await buildExtensionReleaseManifest({ packages: [first], outputDirectory: outputRoot });
    expect(release.manifest.artifacts).toEqual([{
      platform: 'any',
      file: 'community.example-1.0.0-any.gcex',
      media_type: 'application/vnd.glimmer-cradle.extension+zip',
      size: first.archiveSize,
      sha256: first.archiveSha256,
    }]);
    expect(JSON.parse(await fs.readFile(release.manifestPath, 'utf8'))).toEqual(release.manifest);

    const verified = await verifyGcexPackage(first.packagePath);
    expect(verified.manifest.id).toBe('community.example');
    expect(verified.envelope.sbom).toBe('META-INF/sbom.spdx.json');
    expect(verified.files.has('META-INF/sbom.spdx.json')).toBe(true);
    const installedRoot = path.join(root, 'installed');
    await extractVerifiedGcexPackage(verified, installedRoot);
    expect(await fs.readFile(path.join(installedRoot, 'dist', 'index.js'), 'utf8')).toContain('module.exports');
  });

  it('rejects invalid archives', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gcex-integrity-'));
    temporaryRoots.push(root);
    const invalidPath = path.join(root, 'invalid.gcex');
    await fs.writeFile(invalidPath, Buffer.from('not-a-zip'));
    await expect(verifyGcexPackage(invalidPath)).rejects.toThrow();
  });

  it('aggregates multiple platform packages only when release metadata is explicitly requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gcex-multi-platform-'));
    temporaryRoots.push(root);
    const extensionRoot = path.join(root, 'extension');
    const outputRoot = path.join(root, 'release');
    await fs.mkdir(path.join(extensionRoot, 'dist'), { recursive: true });
    await fs.writeFile(path.join(extensionRoot, 'extension-manifest.yaml'), [
      'id: community.multi-platform',
      'name: Multi Platform',
      'version: 2.0.0',
      'publisher: community',
      'license: MIT',
      'repository: https://example.com/community/multi-platform',
      'platforms: [windows-x64, linux-x64]',
      'main: dist/index.js',
    ].join('\n'));
    await fs.writeFile(path.join(extensionRoot, 'gcex.package.yaml'), 'include:\n  - dist\n');
    await fs.writeFile(path.join(extensionRoot, 'dist', 'index.js'), 'module.exports = {};\n');
    const common = {
      extensionRoot,
      outputDirectory: outputRoot,
      sourceRevision: 'abcdef1234567890abcdef1234567890abcdef12',
      sourceTag: 'v2.0.0',
    };
    const windows = await buildGcexPackage({ ...common, platform: 'windows-x64' });
    const linux = await buildGcexPackage({ ...common, platform: 'linux-x64' });

    const release = await buildExtensionReleaseManifest({
      packages: [windows, linux],
      outputDirectory: outputRoot,
      channel: 'beta',
    });
    expect(release.manifest.channel).toBe('beta');
    expect(release.manifest.artifacts.map((artifact) => artifact.platform)).toEqual(['linux-x64', 'windows-x64']);
  });

  it('rejects path traversal before extraction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gcex-traversal-'));
    temporaryRoots.push(root);
    const packagePath = path.join(root, 'traversal.gcex');
    await fs.writeFile(packagePath, zipSync({ '../escape.txt': new TextEncoder().encode('escape') }));
    await expect(verifyGcexPackage(packagePath)).rejects.toThrow('非法路径');
  });

  it('rejects tampered payloads and missing SBOM', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gcex-tamper-'));
    temporaryRoots.push(root);
    const built = await createFixturePackage(root);
    const raw = unzipSync(new Uint8Array(await fs.readFile(built)));

    raw['extension/dist/index.js'] = new TextEncoder().encode('module.exports = { tampered: true };\n');
    const tamperedPath = path.join(root, 'tampered.gcex');
    await fs.writeFile(tamperedPath, zipSync(raw));
    await expect(verifyGcexPackage(tamperedPath)).rejects.toThrow('完整性校验失败');

    const withoutSbom = unzipSync(new Uint8Array(await fs.readFile(built)));
    delete withoutSbom['META-INF/sbom.spdx.json'];
    const missingSbomPath = path.join(root, 'missing-sbom.gcex');
    await fs.writeFile(missingSbomPath, zipSync(withoutSbom));
    await expect(verifyGcexPackage(missingSbomPath)).rejects.toThrow('缺失文件');
  });

  it('rejects archives before expanded content or file count exceeds policy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gcex-limits-'));
    temporaryRoots.push(root);
    const built = await createFixturePackage(root);
    await expect(verifyGcexPackage(built, { maxExpandedBytes: 16 })).rejects.toThrow('解压后内容超过');
    await expect(verifyGcexPackage(built, { maxFiles: 1 })).rejects.toThrow('文件数量超过');
  });
});

async function createFixturePackage(root: string): Promise<string> {
  const extensionRoot = path.join(root, 'extension');
  await fs.mkdir(path.join(extensionRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(extensionRoot, 'extension-manifest.yaml'), [
    'id: community.fixture',
    'name: Fixture',
    'version: 1.0.0',
    'publisher: community',
    'license: MIT',
    'repository: https://example.com/community/fixture',
    'platforms: [any]',
    'main: dist/index.js',
  ].join('\n'));
  await fs.writeFile(path.join(extensionRoot, 'gcex.package.yaml'), 'include:\n  - dist\n');
  await fs.writeFile(path.join(extensionRoot, 'dist', 'index.js'), 'module.exports = {};\n');
  const built = await buildGcexPackage({
    extensionRoot,
    outputDirectory: path.join(root, 'release'),
    platform: 'any',
    sourceRevision: '1234567890abcdef1234567890abcdef12345678',
  });
  return built.packagePath;
}
