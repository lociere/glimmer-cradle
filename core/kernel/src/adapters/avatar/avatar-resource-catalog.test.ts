import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAvatarResourceSnapshots } from './avatar-resource-catalog';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');

describe('Avatar resource catalog canonical host paths', () => {
  it('uses the Unity Host registry and SDK catalog after the legacy project is deleted', () => {
    const registryPath = path.join(
      repoRoot,
      'hosts',
      'unity-avatar-host',
      'Assets',
      'StreamingAssets',
      'avatar-package-registry.json',
    );
    const sdkCatalogPath = path.join(
      repoRoot,
      'hosts',
      'unity-avatar-host',
      'avatar-sdk-catalog.json',
    );
    const legacyProjectPath = path.join(repoRoot, 'core', 'avatar', 'unity-host');

    expect(fs.existsSync(registryPath)).toBe(true);
    expect(fs.existsSync(sdkCatalogPath)).toBe(true);
    expect(fs.existsSync(legacyProjectPath)).toBe(false);

    const snapshots = buildAvatarResourceSnapshots({ repoRoot });
    const registry = snapshots.find((item) => item.resource_id === 'avatar.package-registry');
    const sdkResources = snapshots.filter((item) => item.resource_id.startsWith('avatar.sdk.'));

    expect(registry?.readiness).toBe('ready');
    expect(sdkResources.length).toBeGreaterThan(0);
    expect(sdkResources.every((item) => item.readiness !== 'missing')).toBe(true);
    expect(sdkResources.some((item) => item.readiness === 'ready')).toBe(true);
  });
});
