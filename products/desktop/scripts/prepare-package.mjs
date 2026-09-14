#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stagingRoot = path.join(repoRoot, 'build', 'staging', 'desktop', 'windows-x64');
const temporaryRoot = `${stagingRoot}.prepare-${randomUUID()}`;
const resourcesRoot = path.join(temporaryRoot, 'resources');
const runtimeSource = path.join(repoRoot, 'build', 'runtime', 'desktop', 'windows-x64');
const projections = [
  {
    id: 'kernel',
    owner: 'core/kernel',
    staged: 'runtime/kernel',
  },
  {
    id: 'cognition',
    owner: 'core/cognition',
    staged: 'runtime/python/Lib/site-packages/glimmer_cradle/cognition',
  },
  {
    id: 'audio',
    owner: 'engines/audio',
    staged: 'runtime/python/Lib/site-packages/glimmer_cradle/audio',
  },
  {
    id: 'avatar',
    owner: 'hosts/unity-avatar-host',
    source: path.join(repoRoot, 'build', 'components', 'avatar', 'unity-host', 'windows-x64'),
    staged: 'components/avatar/unity-host',
  },
  {
    id: 'extension-host',
    owner: 'hosts/extension-host',
    source: path.join(repoRoot, 'build', 'extension-host', 'modules'),
    staged: 'extension-host/modules',
  },
  {
    id: 'native',
    owner: 'native',
    source: path.join(repoRoot, 'build', 'components', 'native', 'composition-host', 'windows-x64'),
    staged: 'components/native/composition-host',
    files: [
      'DesktopProcessTreeBridge.exe',
      'bin/Release/platform_native.dll',
      'bin/Release/UnityAvatarHostLauncher.exe',
    ],
  },
];

await fs.mkdir(resourcesRoot, { recursive: true });
try {
  await assertDirectory(runtimeSource, 'runtime');
  await fs.cp(runtimeSource, path.join(resourcesRoot, 'runtime'), {
    recursive: true,
    dereference: true,
  });
  for (const projection of projections) {
    if (!projection.source) continue;
    await assertDirectory(projection.source, projection.id);
    const projectionTarget = path.join(resourcesRoot, projection.staged);
    if (projection.files) {
      for (const relative of projection.files) {
        const source = path.join(projection.source, ...relative.split('/'));
        const target = path.join(projectionTarget, ...relative.split('/'));
        await assertFile(source, `${projection.id}:${relative}`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
      }
    } else {
      await fs.cp(projection.source, projectionTarget, { recursive: true, dereference: true });
    }
    if (projection.id === 'avatar') {
      await fs.copyFile(
        path.join(repoRoot, 'hosts', 'unity-avatar-host', 'avatar-sdk-catalog.json'),
        path.join(projectionTarget, 'avatar-sdk-catalog.json'),
      );
    }
    if (projection.id === 'native') {
      await assertFile(path.join(resourcesRoot, projection.staged, 'DesktopProcessTreeBridge.exe'), 'Desktop process-tree authority');
    }
  }
  await fs.copyFile(
    path.join(repoRoot, 'native', 'package.manifest.json'),
    path.join(resourcesRoot, 'components', 'native', 'package.manifest.json'),
  );
  await fs.mkdir(path.join(resourcesRoot, 'native'), { recursive: true });
  await fs.copyFile(
    path.join(repoRoot, 'native', 'package.manifest.json'),
    path.join(resourcesRoot, 'native', 'package.manifest.json'),
  );
  await fs.mkdir(path.join(resourcesRoot, 'products', 'desktop'), { recursive: true });
  await fs.copyFile(
    path.join(repoRoot, 'products', 'desktop', 'product.json'),
    path.join(resourcesRoot, 'products', 'desktop', 'product.json'),
  );
  const components = [];
  for (const projection of projections) {
    const files = await inventoryFiles(path.join(resourcesRoot, projection.staged), resourcesRoot);
    if (files.length === 0) throw new Error(`Desktop component projection 为空: ${projection.id}`);
    components.push({
      id: projection.id,
      owner: projection.owner,
      projection: projection.staged.replaceAll('\\', '/'),
      files,
    });
  }
  const runtimeFiles = await inventoryFiles(path.join(resourcesRoot, 'runtime'), resourcesRoot);
  const componentManifest = {
    schema_version: 2,
    platform: 'windows-x64',
    generated_by: 'products/desktop/scripts/prepare-package.mjs',
    supervisor: 'app.asar.unpacked/dist/main/packaged-supervisor.js',
    path_resolver: 'app.asar.unpacked/dist/main/packaged-paths.js',
    runtime_manifest: 'runtime/runtime-manifest.json',
    runtime_files: runtimeFiles,
    components,
  };
  await fs.writeFile(
    path.join(resourcesRoot, 'component-manifest.json'),
    `${JSON.stringify(componentManifest, null, 2)}\n`,
  );
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(stagingRoot), { recursive: true });
  await fs.rename(temporaryRoot, stagingRoot);
  process.stdout.write(`${JSON.stringify({
    event: 'desktop_package_staging_prepared',
    staging_root: path.relative(repoRoot, stagingRoot).replaceAll('\\', '/'),
    components: components.map((component) => component.id),
  })}\n`);
} catch (error) {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  throw error;
}

async function assertDirectory(target, componentId) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Desktop component projection 缺失或不可信: ${componentId} (${target})`);
  }
}

async function assertFile(target, componentId) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`Desktop component projection 缺失或不可信: ${componentId} (${target})`);
}

async function inventoryFiles(root, relativeRoot) {
  const targets = await collectInventoryTargets(root);
  const files = new Array(targets.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(16, targets.length) }, async () => {
    while (nextIndex < targets.length) {
      const index = nextIndex++;
      const target = targets[index];
      const bytes = await fs.readFile(target);
      files[index] = {
        path: path.relative(relativeRoot, target).replaceAll('\\', '/'),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
  }));
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function collectInventoryTargets(root) {
  const targets = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Desktop staging 不接受 symlink: ${target}`);
    if (entry.isDirectory()) targets.push(...await collectInventoryTargets(target));
    else if (entry.isFile()) targets.push(target);
  }
  return targets;
}
