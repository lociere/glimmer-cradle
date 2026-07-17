import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const roots = [
  'AGENTS.md',
  '.editorconfig',
  '.codex',
  '.claude',
  '.github',
  'CLAUDE.md',
  'README.md',
  'assets',
  'configs',
  'core',
  'docs',
  'engines',
  'native',
  'packages',
  'products',
  'protocol',
  'scripts',
  'templates',
  'package.json',
  'pnpm-lock.yaml',
  'pyproject.toml',
];
const ignoredDirectories = new Set([
  '.git',
  '.pytest_cache',
  '.venv',
  'Library',
  'Logs',
  'Temp',
  'core/avatar/unity-host/Assets/Live2D',
  'build',
  'dist',
  'node_modules',
]);
const checkedExtensions = new Set([
  '.c',
  '.cpp',
  '.cs',
  '.h',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const checkedNames = new Set(['.editorconfig']);

function shouldIgnoreDirectory(relativePath, name) {
  return ignoredDirectories.has(name) || ignoredDirectories.has(relativePath.replaceAll(path.sep, '/'));
}

function* walk(entryPath) {
  const relativePath = path.relative(root, entryPath);
  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    if (shouldIgnoreDirectory(relativePath, path.basename(entryPath))) {
      return;
    }
    for (const child of fs.readdirSync(entryPath)) {
      yield* walk(path.join(entryPath, child));
    }
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  const ext = path.extname(entryPath);
  const name = path.basename(entryPath);
  if (checkedExtensions.has(ext) || checkedNames.has(name)) {
    yield entryPath;
  }
}

function hasUtf8Bom(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytes = Buffer.alloc(3);
    const read = fs.readSync(fd, bytes, 0, 3, 0);
    return read === 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  } finally {
    fs.closeSync(fd);
  }
}

const filesWithBom = [];
for (const item of roots) {
  const entryPath = path.join(root, item);
  if (!fs.existsSync(entryPath)) {
    continue;
  }
  for (const filePath of walk(entryPath)) {
    if (hasUtf8Bom(filePath)) {
      filesWithBom.push(path.relative(root, filePath));
    }
  }
}

if (filesWithBom.length > 0) {
  console.error('UTF-8 BOM is not allowed in project text files:');
  for (const filePath of filesWithBom) {
    console.error(`- ${filePath}`);
  }
  process.exit(1);
}

console.log('No UTF-8 BOM found.');
