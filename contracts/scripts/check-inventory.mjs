import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a path`);
  return resolve(value);
}

const root = option('--contracts-root', resolve(import.meta.dirname, '..'));
const workspace = option('--workspace-root', resolve(import.meta.dirname, '..', '..'));
const inventoryPath = option('--inventory', resolve(root, 'inventory.md'));
const inventory = readFileSync(inventoryPath, 'utf8');
const required = [
  'protocol/src/schemas/',
  'protocol/src/generated/',
  'Cognition legacy Python projection 已删除',
  'core/avatar/unity-host/Assets/Scripts/Avatar/Contracts/PresentationFrames.g.cs',
  '配置 consumers',
  'SDK consumers',
  'validator',
  'build',
  'package',
  'owner',
  '迁移切片',
  '删除条件',
];

const missing = required.filter((text) => !inventory.includes(text));
if (missing.length > 0) {
  throw new Error(`contracts inventory missing required terms: ${missing.join(', ')}`);
}

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function requireInventoryValue(value, context) {
  if (!inventory.includes(`\`${value}\``)) {
    throw new Error(`contracts inventory missing ${context}: ${value}`);
  }
}

for (const file of walk(resolve(root, 'proto')).filter((path) => path.endsWith('.proto'))) {
  const path = relative(root, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  requireInventoryValue(path, 'canonical proto path');
  const declarations = [
    ...source.matchAll(/\b(?:message|enum|service)\s+([A-Za-z][A-Za-z0-9_]*)\b/g),
    ...source.matchAll(/\brpc\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/g),
  ].map((match) => match[1]);
  for (const symbol of declarations) requireInventoryValue(symbol, `canonical proto symbol from ${path}`);
}

for (const file of walk(resolve(root, 'json-schema')).filter((path) => path.endsWith('.schema.json'))) {
  const path = relative(root, file).replaceAll('\\', '/');
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  requireInventoryValue(path, 'canonical JSON Schema path');
  requireInventoryValue(schema.$id, `canonical JSON Schema $id from ${path}`);
  requireInventoryValue(schema.title, `canonical JSON Schema title from ${path}`);
}

const audioGenerated = resolve(
  workspace, 'engines', 'audio', 'src', 'glimmer_cradle', 'audio', 'generated',
);
if (!existsSync(audioGenerated) || !walk(audioGenerated).some((path) => path.endsWith('.py'))) {
  throw new Error('Audio legacy Python generated output is missing at its real owner path');
}
const cognitionLegacy = resolve(
  workspace, 'core', 'cognition', 'src', 'glimmer_cradle', 'cognition', 'protocol', 'generated',
);
if (existsSync(cognitionLegacy)) {
  throw new Error('Cognition legacy Python generated output must remain deleted');
}

const protocolPackage = readFileSync(resolve(workspace, 'protocol', 'package.json'), 'utf8');
const cognitionProject = readFileSync(resolve(workspace, 'core', 'cognition', 'pyproject.toml'), 'utf8');
const audioProject = readFileSync(resolve(workspace, 'engines', 'audio', 'pyproject.toml'), 'utf8');
if (!protocolPackage.includes('--project ../engines/audio') || protocolPackage.includes('--project ../core/cognition')) {
  throw new Error('Protocol Python generator must execute in the Audio owner project');
}
if (cognitionProject.includes('datamodel-code-generator')) {
  throw new Error('Cognition must not retain the Audio legacy generator tool dependency');
}
if (!audioProject.includes('datamodel-code-generator')) {
  throw new Error('Audio owner project must declare its legacy generator tool dependency');
}

console.log('contracts inventory: ok');
