import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const manifestPath = 'docs/architecture/blueprint/architecture-target-v2.1.json';
export const layoutPath = 'docs/architecture/blueprint/Glimmer_Cradle_Target_Physical_Layout_v2.1.md';
const startMarker = '<!-- target-layout:start -->';
const endMarker = '<!-- target-layout:end -->';

function safePath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\\:*?<>|\u0000-\u001f]/.test(value)
    && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');
}

export function validateTargetManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1 || manifest?.baselineId !== 'glimmer-cradle-architecture-v2.1') {
    errors.push('target manifest: unsupported schema or baseline');
  }
  if (!Array.isArray(manifest?.repositoryFiles) || manifest.repositoryFiles.length === 0) {
    return [...errors, 'target manifest: repositoryFiles must be a nonempty exact file list'];
  }
  const paths = new Set();
  const folded = new Set();
  for (const entry of manifest.repositoryFiles) {
    if (!safePath(entry?.path) || typeof entry.owner !== 'string' || !entry.owner.trim()) {
      errors.push(`target manifest: invalid path or owner: ${JSON.stringify(entry)}`);
      continue;
    }
    if (folded.has(entry.path.toLowerCase())) errors.push(`target manifest: duplicate/case collision: ${entry.path}`);
    paths.add(entry.path);
    folded.add(entry.path.toLowerCase());
    const basename = entry.path.split('/').at(-1);
    if (basename.endsWith('.py') && !/^(?:__[a-z][a-z0-9_]*__|[a-z][a-z0-9_]*)\.py$/.test(basename)) {
      errors.push(`target manifest: Python source must use snake_case: ${entry.path}`);
    }
  }
  for (const file of paths) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (folded.has(parts.slice(0, i).join('/').toLowerCase())) errors.push(`target manifest: file/directory collision: ${file}`);
    }
  }
  for (const key of ['forbiddenFinalRoots', 'forbiddenFinalPaths']) {
    if (!Array.isArray(manifest[key]) || manifest[key].some(p => !safePath(p))) {
      errors.push(`target manifest: invalid ${key}`);
      continue;
    }
    for (const forbidden of manifest[key]) {
      for (const file of paths) {
        if (file === forbidden || file.startsWith(`${forbidden}/`)) errors.push(`target manifest: forbidden target file: ${file}`);
      }
    }
  }
  for (const key of ['generatedAreas', 'physicalSpaces']) {
    if (!Array.isArray(manifest[key]) || manifest[key].length === 0) errors.push(`target manifest: missing ${key}`);
  }
  for (const area of manifest.generatedAreas ?? []) {
    if (!safePath(area.root) || !safePath(area.inventory) || !area.pattern || !area.producer || !area.lifetime) {
      errors.push('target manifest: generated area needs a root, pattern, producer, inventory and lifetime');
    }
  }
  for (const space of manifest.physicalSpaces ?? []) {
    if (!space.name || !space.root || !space.owner || !space.condition || !space.producer
      || !Array.isArray(space.files) || !Array.isArray(space.dynamic)) {
      errors.push('target manifest: physical space lacks owner, files, dynamic rules or conditions');
    }
    for (const file of space.files ?? []) if (!safePath(file)) errors.push(`target manifest: invalid physical file: ${file}`);
  }
  if (!manifest.externalProjects?.source || !manifest.externalProjects?.rule) errors.push('target manifest: missing external project policy');
  return errors;
}

export function renderTargetLayout(manifest) {
  const root = new Map();
  for (const { path: file } of manifest.repositoryFiles) {
    let branch = root;
    for (const part of file.split('/')) {
      if (!branch.has(part)) branch.set(part, new Map());
      branch = branch.get(part);
    }
  }
  let directories = 0;
  const tree = ['glimmer-cradle/'];
  function visit(branch, prefix) {
    const entries = [...branch].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    entries.forEach(([name, children], index) => {
      const last = index === entries.length - 1;
      const directory = children.size > 0;
      if (directory) directories++;
      tree.push(`${prefix}${last ? '└── ' : '├── '}${name}${directory ? '/' : ''}`);
      if (directory) visit(children, prefix + (last ? '    ' : '│   '));
    });
  }
  visit(root, '');
  const lines = [startMarker, '', `精确登记 ${manifest.repositoryFiles.length} 个版本控制文件、${directories} 个父目录。以下是目标，不是当前实物。`, '', '```text', ...tree, '```', '', '### 生成输出登记', '', '| 输出根 | 动态文件模式 | Producer | 逐文件 inventory | 寿命 |', '|---|---|---|---|---|'];
  for (const a of manifest.generatedAreas) lines.push(`| \`${a.root}/\` | \`${a.pattern}\` | ${a.producer} | \`${a.inventory}\` | ${a.lifetime} |`);
  lines.push('', '### 外部项目与其他物理空间', '', `外部项目模板源：\`${manifest.externalProjects.source}\`。${manifest.externalProjects.rule}`);
  for (const s of manifest.physicalSpaces) {
    lines.push('', `#### ${s.name}`, '', `根：\`${s.root}\`；owner：${s.owner}。`, '', `条件：${s.condition}。Producer：${s.producer}。`, '', '固定入口文件：', '', '```text', ...(s.files.length ? s.files : ['（无必须预建的固定文件）']), '```', '', '动态文件模式（不是可省略的源码）：', '', '```text', ...s.dynamic, '```');
  }
  lines.push('', endMarker);
  return lines.join('\n');
}

export function compareTargetFiles(manifest, actualFiles) {
  const expected = new Set(manifest.repositoryFiles.map(entry => entry.path));
  const actual = new Set(actualFiles);
  return [
    ...[...expected].filter(file => !actual.has(file)).sort().map(file => `${file}: missing target file`),
    ...[...actual].filter(file => !expected.has(file)).sort().map(file => `${file}: unexpected final file`),
  ];
}

export function checkTargetLayout(repositoryRoot, { final = false } = {}) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, manifestPath), 'utf8'));
    const errors = validateTargetManifest(manifest);
    if (errors.length) return errors;
    const document = fs.readFileSync(path.join(repositoryRoot, layoutPath), 'utf8').replaceAll('\r\n', '\n');
    const start = document.indexOf(startMarker);
    const end = document.indexOf(endMarker);
    if (start < 0 || end < start || document.indexOf(startMarker, start + 1) !== -1
      || document.indexOf(endMarker, end + 1) !== -1
      || document.slice(start, end + endMarker.length) !== renderTargetLayout(manifest)) {
      errors.push(`${layoutPath}: target tree is out of sync; run check:target-layout --write`);
    }
    if (final) {
      // Only filenames are read; ignored secrets and runtime data are outside source inventory.
      const gitFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      }).split('\0').filter(Boolean);
      const actual = gitFiles.filter(file => fs.existsSync(path.join(repositoryRoot, file)));
      errors.push(...compareTargetFiles(manifest, actual));
      for (const { path: file } of manifest.repositoryFiles) {
        const absolute = path.join(repositoryRoot, file);
        if (!fs.existsSync(absolute)) continue;
        if (!fs.lstatSync(absolute).isFile()) errors.push(`${file}: target must be a regular file, not a directory or symlink`);
      }
    }
    return errors;
  } catch (error) {
    return [`target layout: ${error.message}`];
  }
}

export function writeTargetLayout(repositoryRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, manifestPath), 'utf8'));
  const errors = validateTargetManifest(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  const file = path.join(repositoryRoot, layoutPath);
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end < start || text.indexOf(startMarker, start + 1) !== -1 || text.indexOf(endMarker, end + 1) !== -1) {
    throw new Error('target layout: expected one ordered marker pair');
  }
  fs.writeFileSync(file, text.slice(0, start) + renderTargetLayout(manifest) + text.slice(end + endMarker.length), 'utf8');
}
