import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const roots = [
  'AGENTS.md',
  '.editorconfig',
  '.dockerignore',
  '.gitignore',
  '.codex',
  '.github',
  'README.md',
  'assets',
  'configs',
  'contracts',
  'core',
  'deploy',
  'docs',
  'engines',
  'hosts',
  'native',
  'packages',
  'products',
  'scripts',
  'templates',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'pyproject.toml',
];
const ignoredDirectories = new Set([
  '.git',
  '.pytest_cache',
  '.venv',
  'Library',
  'Logs',
  'Temp',
  'contracts/.tools',
  'hosts/unity-avatar-host/Assets/Live2D',
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
const checkedNames = new Set(['.dockerignore', '.editorconfig', '.gitignore']);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

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
const filesWithInvalidUtf8 = [];
for (const item of roots) {
  const entryPath = path.join(root, item);
  if (!fs.existsSync(entryPath)) {
    continue;
  }
  for (const filePath of walk(entryPath)) {
    if (hasUtf8Bom(filePath)) {
      filesWithBom.push(path.relative(root, filePath));
    }
    try {
      utf8Decoder.decode(fs.readFileSync(filePath));
    } catch {
      filesWithInvalidUtf8.push(path.relative(root, filePath));
    }
  }
}

if (filesWithBom.length > 0 || filesWithInvalidUtf8.length > 0) {
  if (filesWithBom.length > 0) console.error('UTF-8 BOM is not allowed in project text files:');
  for (const filePath of filesWithBom) {
    console.error(`- ${filePath}`);
  }
  if (filesWithInvalidUtf8.length > 0) console.error('Project text files must be valid UTF-8:');
  for (const filePath of filesWithInvalidUtf8) {
    console.error(`- ${filePath}`);
  }
  process.exit(1);
}

console.log('All inventoried text files are valid UTF-8 without BOM.');
