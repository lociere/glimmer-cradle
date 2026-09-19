import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toRepoPath, walkFiles } from './file-system.mjs';

const roots = ['core', 'apps', 'extension-sdk', 'products', 'hosts/extension-host', 'packages', 'templates'];
const skip = new Set(['node_modules', 'dist', 'build', '.venv', '__pycache__', 'generated', 'tests', 'fixtures', 'Library', 'Temp']);
const dependencies = {
  platform: [], content: ['platform'], conversation: ['platform', 'content'],
  capabilities: ['platform', 'content'], jobs: ['platform', 'content'],
  embodiment: ['platform', 'content'],
  cognition: ['platform', 'content', 'conversation', 'capabilities', 'jobs', 'embodiment'],
};
const vendor = /QQ|Discord|Telegram|VRChat|Live2D|OpenAI|Anthropic|Gemini|GitHub|CosyVoice|FunASR/i;

function coreModule(file) { return /^core\/([^/]+)\//.exec(file)?.[1]; }
function isExtension(file) { return /^(?:extensions|templates)\//.test(file) || file.includes('/extensions/'); }

export function readSourceImports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const vendors = [];
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      specifier = node.arguments[0];
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifier = node.argument.literal;
    }
    if (specifier) imports.push({ value: specifier.text, line: source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1 });
    // AST excludes comments: references in documentation are not domain names.
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && vendor.test(node.text)) {
      vendors.push({ value: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { imports, vendors };
}

export function findImportCycles(edges) {
  let next = 0;
  const index = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
  function visit(file) {
    index.set(file, next); low.set(file, next++); stack.push(file); active.add(file);
    for (const target of edges.get(file) ?? []) {
      if (!index.has(target)) { visit(target); low.set(file, Math.min(low.get(file), low.get(target))); }
      else if (active.has(target)) low.set(file, Math.min(low.get(file), index.get(target)));
    }
    if (low.get(file) === index.get(file)) {
      const group = []; let item;
      do { item = stack.pop(); active.delete(item); group.push(item); } while (item !== file);
      if (group.length > 1 || edges.get(file)?.has(file)) cycles.push(group.sort());
    }
  }
  for (const file of [...edges.keys()].sort()) if (!index.has(file)) visit(file);
  return cycles;
}

export function collectV2Violations(repositoryRoot) {
  const files = roots.flatMap(root => [...walkFiles(path.join(repositoryRoot, root), { skip })]);
  const sources = files.filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file) && !/\.(?:test|spec)\.[^.]+$/.test(file));
  const manifests = files.filter(file => path.basename(file) === 'package.json').map(file => ({
    file: toRepoPath(repositoryRoot, file), ...JSON.parse(fs.readFileSync(file, 'utf8')),
  }));
  const packages = new Map(manifests.filter(m => m.name).map(m => [m.name, m]));
  const known = new Set(sources.map(file => toRepoPath(repositoryRoot, file)));
  const edges = new Map([...known].map(file => [file, new Set()]));
  const violations = [];
  function add(file, rule, detail, line = 1) { violations.push({ file, rule, detail, line }); }
  function resolveSource(base) {
    return [base, base + '.ts', base + '.tsx', base + '.mts', base + '.js', base + '.mjs',
      base + '/index.ts', base + '/index.tsx', base + '/index.js', base.replace(/\.js$/, '.ts')].find(candidate => known.has(candidate));
  }
  for (const filePath of sources) {
    const file = toRepoPath(repositoryRoot, filePath), owner = coreModule(file);
    const { imports, vendors } = readSourceImports(file, fs.readFileSync(filePath, 'utf8'));
    if (owner) for (const match of vendors) add(file, 'vendor-core', match.value, match.line);
    for (const spec of imports) {
      const packageName = spec.value.startsWith('@') ? spec.value.split('/').slice(0, 2).join('/') : spec.value.split('/')[0];
      const manifest = packages.get(packageName);
      const targetBase = spec.value.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.value))
        : manifest ? path.posix.dirname(manifest.file) : spec.value;
      const targetOwner = coreModule(targetBase + '/');
      if (owner && (packageName === '@glimmer-cradle/extension-sdk' || /^(?:packages\/)?extension-sdk(?:\/|$)/.test(targetBase))) {
        add(file, 'core-sdk', spec.value, spec.line);
      }
      if (owner && packageName === '@modelcontextprotocol/sdk') add(file, 'vendor-core', spec.value, spec.line);
      if (owner && dependencies[owner] && targetOwner && owner !== targetOwner && !dependencies[owner].includes(targetOwner)) {
        add(file, 'dependency-direction', `${owner} -> ${targetOwner}: ${spec.value}`, spec.line);
      }
      if (isExtension(file) && (targetOwner || packageName === '@glimmer-cradle/kernel')) {
        add(file, 'extension-internal', spec.value, spec.line);
      }
      if (targetOwner && owner !== targetOwner && spec.value.startsWith('.')) {
        // Public relative entrypoints remain explicit during physical migration.
        if (!/^core\/[^/]+\/(?:index(?:\.[cm]?[jt]s)?|src\/index(?:\.[cm]?[jt]s)?)$/.test(targetBase)) {
          add(file, 'deep-import', spec.value, spec.line);
        }
      }
      if (manifest && spec.value !== packageName && targetOwner) {
        const subpath = '.' + spec.value.slice(packageName.length);
        if (!manifest.exports || !Object.hasOwn(manifest.exports, subpath)) add(file, 'deep-import', spec.value, spec.line);
      }
      if (spec.value.startsWith('.')) {
        const target = resolveSource(targetBase);
        if (target) edges.get(file).add(target);
      }
    }
  }
  const packageEdges = new Map();
  for (const manifest of manifests) {
    const owner = coreModule(manifest.file);
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies };
    packageEdges.set(manifest.name, new Set(Object.keys(deps).filter(name => packages.has(name))));
    for (const name of Object.keys(deps)) {
      if (owner && name === '@glimmer-cradle/extension-sdk') add(manifest.file, 'core-sdk', name);
      const target = coreModule(packages.get(name)?.file ?? '');
      if (owner && dependencies[owner] && target && target !== owner && !dependencies[owner].includes(target)) {
        add(manifest.file, 'dependency-direction', `${owner} -> ${target}: ${name}`);
      }
      if (owner && vendor.test(name)) add(manifest.file, 'vendor-core', name);
    }
    if (owner && dependencies[owner] && !manifest.exports) add(manifest.file, 'public-entrypoint', 'Core package requires explicit exports');
  }
  for (const cycle of findImportCycles(edges)) add(cycle[0], 'source-cycle', cycle.join(' -> '));
  for (const cycle of findImportCycles(packageEdges)) add(packages.get(cycle[0]).file, 'package-cycle', cycle.join(' -> '));
  const pythonFiles = files.filter(file => file.endsWith('.py'));
  if (pythonFiles.length) {
    const parsed = spawnSync('uv', ['run', '--no-project', '--python', '3.12', fileURLToPath(new URL('./python-imports.py', import.meta.url))], {
      cwd: repositoryRoot, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      input: JSON.stringify(pythonFiles.map(file => ({ file: toRepoPath(repositoryRoot, file), text: fs.readFileSync(file, 'utf8') }))),
    });
    if (parsed.error || parsed.status !== 0) {
      add('core', 'python-analysis', 'Python AST analysis failed; uv and Python 3.12 are required');
    } else {
      const modules = JSON.parse(parsed.stdout);
      const byName = new Map(modules.map(module => [module.module, module]));
      const pythonEdges = new Map(modules.map(module => [module.module, new Set()]));
      for (const module of modules) {
        const owner = coreModule(module.file);
        if (owner) for (const match of module.vendors) add(module.file, 'vendor-core', match.value, match.line);
        for (const spec of module.imports) {
          const targetOwner = /^glimmer_cradle\.([^.]*)/.exec(spec.value)?.[1];
          if (owner && targetOwner && dependencies[owner] && targetOwner !== owner && !dependencies[owner].includes(targetOwner)) {
            add(module.file, 'dependency-direction', `${owner} -> ${targetOwner}: ${spec.value}`, spec.line);
          }
          if (targetOwner && owner !== targetOwner && spec.value.split('.').length > 2) add(module.file, 'deep-import', spec.value, spec.line);
          if (isExtension(module.file) && targetOwner) add(module.file, 'extension-internal', spec.value, spec.line);
          for (const target of [spec.value, ...(spec.members ?? []).map(member => spec.value + '.' + member)]) {
            if (target !== module.module && byName.has(target)) pythonEdges.get(module.module).add(target);
          }
        }
      }
      for (const cycle of findImportCycles(pythonEdges)) add(byName.get(cycle[0]).file, 'source-cycle', cycle.join(' -> '));
    }
  }
  return violations;
}

export function violationKey(item) { return JSON.stringify([item.file, item.rule, item.detail]); }

export function applyV2Exceptions(violations, exceptions) {
  const actual = new Map();
  for (const item of violations) {
    const key = violationKey(item);
    const entry = actual.get(key) ?? { item, count: 0 };
    entry.count++; actual.set(key, entry);
  }
  const errors = [], seen = new Set();
  for (const exception of exceptions) {
    const key = violationKey(exception);
    if (seen.has(key) || !exception.owner || !exception.removeBy || !exception.reason || !Number.isInteger(exception.count) || exception.count < 1) {
      errors.push(`v2 exception invalid: ${key}`); continue;
    }
    seen.add(key);
    const count = actual.get(key)?.count ?? 0;
    if (count !== exception.count) errors.push(`${exception.file}: v2 legacy count ${count} != ${exception.count}; remove stale debt or fix new violations (${exception.rule})`);
    actual.delete(key);
  }
  for (const { item } of actual.values()) errors.push(`${item.file}:${item.line}: ${item.rule}: ${item.detail}`);
  return errors;
}

export function checkV2Boundaries(repositoryRoot) {
  const baseline = path.join(repositoryRoot, 'tools/repo-checks/src/architecture/v2-legacy-exceptions.json');
  const exceptions = fs.existsSync(baseline) ? JSON.parse(fs.readFileSync(baseline, 'utf8')) : [];
  return applyV2Exceptions(collectV2Violations(repositoryRoot), exceptions);
}
