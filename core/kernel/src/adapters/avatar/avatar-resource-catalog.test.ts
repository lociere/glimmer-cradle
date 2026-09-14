import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAvatarResourceSnapshots } from './avatar-resource-catalog';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');

describe('Avatar resource catalog canonical host paths', () => {
  it('uses the Unity Host registry and SDK catalog after legacy project sources are deleted', () => {
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
    const legacyProjectMarker = path.join(legacyProjectPath, 'ProjectSettings', 'ProjectVersion.txt');
    const legacyProjection = path.join(
      legacyProjectPath,
      'Assets',
      'Scripts',
      'Avatar',
      'Contracts',
      'PresentationFrames.g.cs',
    );

    expect(fs.existsSync(registryPath)).toBe(true);
    expect(fs.existsSync(sdkCatalogPath)).toBe(true);
    // 本机可能保留被 Git 忽略的 Unity Library 或专有 SDK；删除门约束仓库源码入口和 projection。
    expect(fs.existsSync(legacyProjectMarker)).toBe(false);
    expect(fs.existsSync(legacyProjection)).toBe(false);

    const snapshots = buildAvatarResourceSnapshots({ repoRoot });
    const registry = snapshots.find((item) => item.resource_id === 'avatar.package-registry');
    const catalog = snapshots.find((item) => item.resource_id === 'avatar.sdk.catalog');
    const cubism = snapshots.find((item) => item.resource_id === 'avatar.sdk.cubism-unity');

    expect(registry?.readiness).toBe('ready');
    if (cubism) {
      expect(['missing', 'ready']).toContain(cubism.readiness);
      if (cubism.readiness === 'missing') {
        expect(cubism.recovery_actions?.some((action) => action.includes('data/packages/avatar-sdks'))).toBe(true);
      }
    } else {
      expect(catalog?.readiness).toBe('ready');
      expect(catalog?.summary).toContain('当前没有需要 Unity SDK');
    }
  });

  it('uses explicit installed Player resources without consulting workspace SDK files', () => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync.native(process.env.TEMP || process.cwd()), 'avatar-installed-'));
    try {
      const registryPath = path.join(root, 'UnityAvatarHost_Data', 'StreamingAssets', 'avatar-package-registry.json');
      const sdkCatalogPath = path.join(root, 'avatar-sdk-catalog.json');
      const playerPath = path.join(root, 'UnityAvatarHost.exe');
      fs.ensureDirSync(path.dirname(registryPath));
      fs.writeJsonSync(registryPath, { models: [{ modelFormat: 'cubism4' }] });
      fs.writeJsonSync(sdkCatalogPath, { sdks: [{ id: 'cubism-unity', displayName: 'Cubism', modelFormats: ['cubism4'] }] });
      fs.writeFileSync(playerPath, 'fixture');

      const snapshots = buildAvatarResourceSnapshots({
        repoRoot: path.join(root, 'absent-workspace'),
        commandPath: playerPath,
        workingDir: root,
        playerPath,
        registryPath,
        sdkCatalogPath,
      });
      expect(snapshots.find((item) => item.resource_id === 'avatar.package-registry')?.readiness).toBe('ready');
      expect(snapshots.find((item) => item.resource_id === 'avatar.host.player')?.readiness).toBe('ready');
      expect(snapshots.find((item) => item.resource_id === 'avatar.sdk.cubism-unity')).toMatchObject({
        readiness: 'ready',
        actual_state: 'ready',
      });
    } finally {
      fs.removeSync(root);
    }
  });
});
