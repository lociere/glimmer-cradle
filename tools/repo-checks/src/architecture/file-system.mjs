import fs from 'node:fs';
import path from 'node:path';

const derivedCacheDirectories = new Set([
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
]);

export function* walkFiles(root, { skip = new Set() } = {}) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (skip.has(entry.name) || derivedCacheDirectories.has(entry.name)) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(entryPath, { skip });
    else if (entry.isFile()) yield entryPath;
  }
}

export function toRepoPath(repositoryRoot, filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
