import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const checkedExtensions = new Set([
  '.c', '.cpp', '.cs', '.h', '.js', '.json', '.md', '.mjs', '.py', '.svg', '.toml',
  '.ts', '.tsx', '.yaml', '.yml',
]);
const checkedNames = new Set(['.dockerignore', '.editorconfig', '.gitignore']);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function listInventoriedTextFiles(repositoryRoot, { runGit = spawnSync } = {}) {
  const result = runGit(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, encoding: 'buffer', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`无法读取 Git text inventory（exit ${result.status ?? 1}）`);
  }
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => {
      const normalized = relativePath.replaceAll('\\', '/');
      return checkedExtensions.has(path.extname(normalized)) || checkedNames.has(path.basename(normalized));
    })
    .sort();
}

export function checkEncoding(repositoryRoot, options = {}) {
  const violations = [];
  for (const relativePath of listInventoriedTextFiles(repositoryRoot, options)) {
    const filePath = path.join(repositoryRoot, relativePath);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      violations.push(`${relativePath}: 无法读取 inventoried text（${error.code ?? 'unknown'}）`);
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = fs.readFileSync(filePath);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      violations.push(`${relativePath}: UTF-8 BOM 不允许`);
    }
    try {
      utf8Decoder.decode(bytes);
    } catch {
      violations.push(`${relativePath}: 不是合法 UTF-8`);
    }
  }
  return violations;
}
