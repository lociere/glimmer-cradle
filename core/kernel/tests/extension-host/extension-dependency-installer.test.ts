import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedResourceContribution } from '@glimmer-cradle/protocol';
import type { ExtensionLogger } from '../../src/foundation/ports';
import { ExtensionDependencyInstaller } from '../../src/host/extension-dependency-installer';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('ExtensionDependencyInstaller', () => {
  it('复用缓存包并解压到声明的 installDir', async () => {
    const root = await createTempRoot();
    const extensionId = 'test.extension';
    const assetName = 'example-package.zip';
    const sourceDir = path.join(root, 'source');
    const archivePath = path.join(root, 'data', 'cache', 'extension-dependencies', extensionId, assetName);

    await fs.mkdir(path.join(sourceDir, 'example'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'example', 'ready.txt'), 'ok', 'utf-8');
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await createArchive(archivePath, sourceDir);

    const installer = new ExtensionDependencyInstaller(root, new SilentLogger());
    await installer.prepare(extensionId, [createDependency(assetName)]);

    await expect(
      fs.readFile(path.join(root, 'data', 'packages', 'example', 'ready.txt'), 'utf-8'),
    ).resolves.toBe('ok');
  });
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-extension-installer-'));
  tempRoots.push(root);
  return root;
}

function createDependency(assetName: string): ManagedResourceContribution {
  return {
    id: 'example',
    displayName: 'Example',
    kind: 'package',
    audience: 'host',
    scope: { kind: 'global' },
    requirements: { products: ['any'], platforms: ['any'], features: [] },
    permissions: [],
    dependsOn: [],
    metadata: {},
    required: true,
    package: {
      source: {
        type: 'githubRelease',
        repository: 'example/example',
        assetName,
      },
      installDir: 'data/packages/example',
    },
  };
}

function createArchive(archivePath: string, sourceDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-cf', archivePath, '-C', sourceDir, '.'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

class SilentLogger implements ExtensionLogger {
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}
