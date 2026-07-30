#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const relative of [
  'hosts/unity-avatar-host/scripts/build.mjs',
  'hosts/unity-avatar-host/scripts/project-sdk.mjs',
  'hosts/unity-avatar-host/scripts/sync-assets.mjs',
  'core/avatar/unity-host/ProjectSettings/ProjectVersion.txt',
]) {
  await access(path.join(repoRoot, relative));
}
process.stdout.write(`${JSON.stringify({
  event: 'unity_avatar_host_verified',
  current_project_root: 'core/avatar/unity-host',
  target_project_root: 'hosts/unity-avatar-host',
  project_migration_owner: 'M12 Slice 5',
})}\n`);
