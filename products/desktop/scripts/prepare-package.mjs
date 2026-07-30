#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stagingRoot = path.join(repoRoot, 'build', 'staging', 'desktop', 'windows-x64');
const temporaryRoot = `${stagingRoot}.prepare-${randomUUID()}`;
const resourcesRoot = path.join(temporaryRoot, 'resources');
const projections = [
  {
    id: 'kernel',
    owner: 'core/kernel',
    source: path.join(repoRoot, 'core', 'kernel', 'dist'),
    destination: 'components/kernel',
  },
  {
    id: 'cognition',
    owner: 'core/cognition',
    source: path.join(repoRoot, 'core', 'cognition'),
    destination: 'components/cognition',
    filter: sourceFilter,
  },
  {
    id: 'audio',
    owner: 'engines/audio',
    source: path.join(repoRoot, 'engines', 'audio'),
    destination: 'components/audio',
    filter: sourceFilter,
  },
  {
    id: 'avatar',
    owner: 'hosts/unity-avatar-host',
    source: path.join(repoRoot, 'build', 'components', 'avatar', 'unity-host', 'windows-x64'),
    destination: 'components/avatar/unity-host',
  },
  {
    id: 'extension-host',
    owner: 'packages/extension-sdk',
    source: path.join(repoRoot, 'build', 'extension-host', 'modules'),
    destination: 'extension-host/modules',
  },
  {
    id: 'native',
    owner: 'native',
    source: path.join(repoRoot, 'build', 'components', 'native', 'composition-host', 'windows-x64'),
    destination: 'components/native/composition-host',
  },
];

await fs.mkdir(resourcesRoot, { recursive: true });
try {
  for (const projection of projections) {
    await assertDirectory(projection.source, projection.id);
    await fs.cp(
      projection.source,
      path.join(resourcesRoot, projection.destination),
      { recursive: true, dereference: false, filter: projection.filter },
    );
  }
  await fs.copyFile(
    path.join(repoRoot, 'native', 'package.manifest.json'),
    path.join(resourcesRoot, 'components', 'native', 'package.manifest.json'),
  );
  const components = [];
  for (const projection of projections) {
    const files = await inventoryFiles(path.join(resourcesRoot, projection.destination), resourcesRoot);
    if (files.length === 0) throw new Error(`Desktop component projection 为空: ${projection.id}`);
    components.push({
      id: projection.id,
      owner: projection.owner,
      projection: projection.destination.replaceAll('\\', '/'),
      files,
    });
  }
  const componentManifest = {
    schema_version: 1,
    platform: 'windows-x64',
    generated_by: 'products/desktop/scripts/prepare-package.mjs',
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

async function inventoryFiles(root, relativeRoot) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Desktop staging 不接受 symlink: ${target}`);
    if (entry.isDirectory()) {
      files.push(...await inventoryFiles(target, relativeRoot));
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(target);
      files.push({
        path: path.relative(relativeRoot, target).replaceAll('\\', '/'),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function sourceFilter(source) {
  const normalized = source.replaceAll('\\', '/');
  return !/(?:^|\/)(?:\.venv|__pycache__|\.pytest_cache|tests)(?:\/|$)/.test(normalized);
}
