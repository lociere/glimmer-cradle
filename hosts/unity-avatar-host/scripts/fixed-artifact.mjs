#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const buildRoot = path.resolve(process.env.GLIMMER_CRADLE_BUILD_ROOT || path.join(repoRoot, 'build'));
const mode = process.argv[2];
const artifactRoot = path.resolve(process.argv[3] || '');

if (mode === 'create') {
  const sourceCommit = process.argv[4] || '';
  if (!/^[0-9a-f]{40,64}$/.test(sourceCommit)) throw new Error('Avatar source commit 无效');
  await fs.rm(artifactRoot, { recursive: true, force: true });
  await fs.mkdir(artifactRoot, { recursive: true });
  await copyTrusted(
    path.join(buildRoot, 'components', 'avatar', 'unity-host', 'windows-x64'),
    path.join(artifactRoot, 'avatar'),
  );
  await copyTrusted(
    path.join(buildRoot, 'components', 'native', 'composition-host', 'windows-x64'),
    path.join(artifactRoot, 'native'),
  );
  const manifest = {
    schema_version: 1,
    owner: 'hosts/unity-avatar-host',
    platform: 'windows-x64',
    source_commit: sourceCommit,
    files: await inventory(artifactRoot),
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(artifactRoot, 'artifact-manifest.json'), bytes);
  process.stdout.write(`${JSON.stringify({
    event: 'avatar_fixed_artifact_created',
    manifest_digest: createHash('sha256').update(bytes).digest('hex'),
  })}\n`);
} else if (mode === 'consume') {
  const expectedCommit = process.argv[4] || '';
  const expectedDigest = process.argv[5] || '';
  const bytes = await fs.readFile(path.join(artifactRoot, 'artifact-manifest.json'));
  const manifest = JSON.parse(bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest
    || manifest.source_commit !== expectedCommit
    || manifest.owner !== 'hosts/unity-avatar-host'
    || manifest.platform !== 'windows-x64') {
    throw new Error('Avatar fixed artifact identity mismatch');
  }
  const files = await inventory(artifactRoot, new Set(['artifact-manifest.json']));
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) {
    throw new Error('Avatar fixed artifact content mismatch');
  }
  await projectAtomically(
    path.join(artifactRoot, 'avatar'),
    path.join(buildRoot, 'components', 'avatar', 'unity-host', 'windows-x64'),
  );
  await projectAtomically(
    path.join(artifactRoot, 'native'),
    path.join(buildRoot, 'components', 'native', 'composition-host', 'windows-x64'),
  );
  process.stdout.write(`${JSON.stringify({ event: 'avatar_fixed_artifact_consumed' })}\n`);
} else {
  throw new Error('用法: fixed-artifact.mjs create|consume <artifact-root> <commit> [manifest-digest]');
}

async function projectAtomically(source, destination) {
  const temporary = `${destination}.project-${randomUUID()}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await copyTrusted(source, temporary);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(temporary, destination);
}

async function copyTrusted(source, destination) {
  const sourceStat = await fs.lstat(source).catch(() => null);
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Avatar fixed artifact source 缺失或不可信: ${source}`);
  }
  await fs.cp(source, destination, { recursive: true, dereference: false });
  if ((await inventory(destination)).length === 0) throw new Error(`Avatar fixed artifact 为空: ${source}`);
}

async function inventory(root, excluded = new Set(), base = root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Avatar fixed artifact 不接受 symlink: ${target}`);
    if (entry.isDirectory()) {
      files.push(...await inventory(target, excluded, base));
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(target);
      files.push({
        path: path.relative(base, target).replaceAll('\\', '/'),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
