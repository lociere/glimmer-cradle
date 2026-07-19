import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExtensionPackageManager } from './extension-package-manager';

const mockedVerifier = vi.hoisted(() => ({
  verifyExtensionPackageMock: vi.fn(async () => createVerifiedPackage()),
  extractVerifiedExtensionPackageMock: vi.fn(async (_verified: unknown, targetDir: string) => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, 'extension-manifest.yaml'), 'id: community.test\nversion: 1.0.0\n', 'utf8');
  }),
}));

vi.mock('./extension-package-verifier', () => ({
  verifyExtensionPackage: mockedVerifier.verifyExtensionPackageMock,
  extractVerifiedExtensionPackage: mockedVerifier.extractVerifiedExtensionPackageMock,
}));

const originalAppRoot = process.env.GLIMMER_CRADLE_APP_ROOT;
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;

afterEach(() => {
  restoreEnvironment('GLIMMER_CRADLE_APP_ROOT', originalAppRoot);
  restoreEnvironment('GLIMMER_CRADLE_DATA_ROOT', originalDataRoot);
  mockedVerifier.verifyExtensionPackageMock.mockClear();
  mockedVerifier.extractVerifiedExtensionPackageMock.mockClear();
});

describe('ExtensionPackageManager', () => {
  it('cleans orphaned transaction directories on initialize after a restart', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'extension-package-manager-'));
    process.env.GLIMMER_CRADLE_APP_ROOT = root;
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');

    const transactionRoot = path.join(root, 'data', 'cache', 'extensions', 'package-manager', 'transactions');
    const orphanRoot = path.join(transactionRoot, 'orphan-preview-tx');
    mkdirSync(orphanRoot, { recursive: true });
    writeFileSync(path.join(orphanRoot, 'marker.txt'), 'stale', 'utf8');

    const manager = new ExtensionPackageManager(path.join(root, 'data', 'packages', 'extensions'), 'personal-server');
    await manager.initialize();

    expect(existsSync(orphanRoot)).toBe(false);
    manager.dispose();
  });

  it('cleans orphaned staging directories on initialize after a restart', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'extension-package-manager-'));
    process.env.GLIMMER_CRADLE_APP_ROOT = root;
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');

    const stagingRoot = path.join(root, 'data', 'packages', 'extensions', '.staging');
    const orphanRoot = path.join(stagingRoot, 'orphan-commit-tx');
    mkdirSync(orphanRoot, { recursive: true });
    writeFileSync(path.join(orphanRoot, 'marker.txt'), 'stale', 'utf8');

    const manager = new ExtensionPackageManager(path.join(root, 'data', 'packages', 'extensions'), 'personal-server');
    await manager.initialize();

    expect(existsSync(orphanRoot)).toBe(false);
    manager.dispose();
  });

  it('removes staging artifacts when commit fails before move', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'extension-package-manager-'));
    process.env.GLIMMER_CRADLE_APP_ROOT = root;
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const extensionRoot = path.join(root, 'data', 'packages', 'extensions');
    const manager = new ExtensionPackageManager(extensionRoot, 'personal-server');
    await manager.initialize();

    const transactionId = 'tx-target-exists';
    const archivePath = path.join(root, 'archive.gcex');
    writeFileSync(archivePath, 'fixture', 'utf8');
    seedPendingTransaction(manager, transactionId, archivePath);
    const targetDir = path.join(extensionRoot, 'community.test', '1.0.0');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(targetDir, 'marker.txt'), 'occupied', 'utf8');

    await expect(manager.commitInstall(transactionId, [])).rejects.toThrow('扩展安装目标已存在');
    expect(existsSync(path.join(extensionRoot, '.staging', transactionId))).toBe(false);
    expect(existsSync(targetDir)).toBe(true);

    manager.dispose();
  });

  it('removes staging and target directories when metadata persistence fails after move', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'extension-package-manager-'));
    process.env.GLIMMER_CRADLE_APP_ROOT = root;
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(root, 'data');
    const extensionRoot = path.join(root, 'data', 'packages', 'extensions');
    const manager = new ExtensionPackageManager(extensionRoot, 'personal-server');
    await manager.initialize();

    const transactionId = 'tx-metadata-fail';
    const archivePath = path.join(root, 'archive.gcex');
    writeFileSync(archivePath, 'fixture', 'utf8');
    seedPendingTransaction(manager, transactionId, archivePath);

    const metadataPath = path.join(root, 'data', 'state', 'kernel', 'extension-installations', 'community.test', '1.0.0.json');
    mkdirSync(path.dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, JSON.stringify({ artifact_sha256: 'other-sha' }), 'utf8');

    await expect(manager.commitInstall(transactionId, [])).rejects.toThrow();
    expect(existsSync(path.join(extensionRoot, '.staging', transactionId))).toBe(false);
    expect(existsSync(path.join(extensionRoot, 'community.test', '1.0.0'))).toBe(false);

    manager.dispose();
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function seedPendingTransaction(
  manager: ExtensionPackageManager,
  transactionId: string,
  packagePath: string,
): void {
  (manager as unknown as {
    pending: Map<string, {
      preview: {
        transaction_id: string;
        extension: {
          id: string;
          name: string;
          version: string;
          publisher: string;
          permissions: string[];
          products: ['personal-server'];
          platforms: ['any'];
        };
        artifact: { sha256: string; size: number; platform: 'any' };
        trust: {
          source_kind: 'file';
          listing_reviewed: false;
          publisher_verified: false;
          artifact_signed: false;
          build_attested: false;
        };
      };
      packagePath: string;
      verified: unknown;
      createdAt: number;
    }>;
  }).pending.set(transactionId, {
    preview: {
      transaction_id: transactionId,
      extension: {
        id: 'community.test',
        name: 'Community Test',
        version: '1.0.0',
        publisher: 'fixture',
        permissions: [],
        products: ['personal-server'],
        platforms: ['any'],
      },
      artifact: {
        sha256: 'fixture-sha256',
        size: 7,
        platform: 'any',
      },
      trust: {
        source_kind: 'file',
        listing_reviewed: false,
        publisher_verified: false,
        artifact_signed: false,
        build_attested: false,
      },
    },
    packagePath,
    verified: createVerifiedPackage(),
    createdAt: Date.now(),
  });
}

function createVerifiedPackage(): {
  readonly manifest: {
    readonly id: 'community.test';
    readonly name: 'Community Test';
    readonly version: '1.0.0';
    readonly publisher: 'fixture';
    readonly permissions: [];
    readonly products: ['personal-server'];
    readonly platforms: ['any'];
  };
  readonly archiveSha256: 'fixture-sha256';
  readonly archiveSize: 7;
} {
  return {
    manifest: {
      id: 'community.test',
      name: 'Community Test',
      version: '1.0.0',
      publisher: 'fixture',
      permissions: [],
      products: ['personal-server'],
      platforms: ['any'],
    },
    archiveSha256: 'fixture-sha256',
    archiveSize: 7,
  };
}
