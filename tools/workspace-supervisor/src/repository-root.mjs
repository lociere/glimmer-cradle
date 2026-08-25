import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupervisorInputError } from './errors.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveRepositoryRoot(explicitRoot) {
  const repositoryRoot = path.resolve(explicitRoot ?? path.join(packageRoot, '..', '..'));
  const manifestPath = path.join(repositoryRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new SupervisorInputError(`repository root 缺少 package.json: ${repositoryRoot}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== 'glimmer-cradle') {
    throw new SupervisorInputError(`不是 Glimmer Cradle repository root: ${repositoryRoot}`);
  }
  return repositoryRoot;
}
