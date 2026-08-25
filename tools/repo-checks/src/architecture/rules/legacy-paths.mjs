import fs from 'node:fs';
import path from 'node:path';

const removedPaths = [
  'protocol',
  'core/kernel/project.json',
  'core/kernel/src/foundation',
  'core/kernel/src/host',
  'core/kernel/src/infrastructure',
  'core/kernel/src/lifecycle',
  'core/kernel/src/core',
  'core/kernel/src/sdk',
  'core/desktop',
  'extensions',
  'products/server',
  'packages/extension-contracts',
  'products/product.schema.json',
  'core/cognition/src/cognition_core',
  'engines/audio/src/audio_engine',
  'data/artifacts',
  'data/backup',
  'data/blobs',
  'data/tmp',
  'data/legacy',
  'output',
  '.tmp',
  '.agents',
  'deploy/personal-server/host-transaction.sh',
];

export function checkLegacyPaths(repositoryRoot) {
  return removedPaths
    .filter((relativePath) => fs.existsSync(path.join(repositoryRoot, relativePath)))
    .map((relativePath) => `${relativePath}: 已删除的 legacy 物理主线被重新引入`);
}
