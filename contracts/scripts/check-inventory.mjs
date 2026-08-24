import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';

const GENERATOR_PACKAGE = 'datamodel-code-generator';
const AUDIO_PROJECT = 'glimmer-cradle-audio-engine';
const COGNITION_PROJECT = 'glimmer-cradle-cognition';

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
  'proto/glimmer/avatar/v1/avatar_host.proto',
  'proto/glimmer/engine/audio/v1/audio_engine.proto',
  'hosts/unity-avatar-host/Assets/Scripts/GlimmerCradle/Adapters/AvatarContractAdapter.cs',
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
if (existsSync(audioGenerated) && walk(audioGenerated).some((path) => path.endsWith('.py'))) {
  throw new Error('Audio legacy Python generated output must remain deleted');
}
const legacyAudioSchemaDir = resolve(workspace, 'protocol', 'src', 'schemas', 'engine');
if (existsSync(legacyAudioSchemaDir) && walk(legacyAudioSchemaDir).length > 0) {
  throw new Error(`Audio legacy contract path must remain deleted: ${legacyAudioSchemaDir}`);
}
const legacyAudioTsProjection = resolve(workspace, 'protocol', 'src', 'generated', 'engine');
if (existsSync(legacyAudioTsProjection) && walk(legacyAudioTsProjection).length > 0) {
  throw new Error(`Audio legacy generated projection must remain deleted: ${legacyAudioTsProjection}`);
}
for (const legacyPath of [
  resolve(workspace, 'protocol', 'codegen', 'gen-py.py'),
  resolve(workspace, 'protocol', 'codegen', 'gen-cs.ts'),
  resolve(workspace, 'engines', 'audio', 'src', 'glimmer_cradle', 'audio', 'protocol.py'),
]) {
  if (existsSync(legacyPath)) throw new Error(`Audio legacy contract path must remain deleted: ${legacyPath}`);
}
const cognitionLegacy = resolve(
  workspace, 'core', 'cognition', 'src', 'glimmer_cradle', 'cognition', 'protocol', 'generated',
);
if (existsSync(cognitionLegacy)) {
  throw new Error('Cognition legacy Python generated output must remain deleted');
}

const audioProto = readFileSync(
  resolve(root, 'proto', 'glimmer', 'engine', 'audio', 'v1', 'audio_engine.proto'),
  'utf8',
);
if (/\bbytes\s+[A-Za-z][A-Za-z0-9_]*\s*=/u.test(audioProto)) {
  throw new Error('Audio control contract must not carry media bytes in ordinary RPC messages');
}
for (const field of ['lease_id', 'uri', 'size_bytes', 'sha256', 'expires_at_ms', 'access']) {
  if (!new RegExp(`\\b${field}\\s*=`, 'u').test(audioProto)) {
    throw new Error(`AudioMediaReference missing required data-plane field: ${field}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readToml(path, context) {
  if (!existsSync(path)) throw new Error(`${context} is missing: ${path}`);
  return parseToml(readFileSync(path, 'utf8'));
}

function dependencyName(requirement) {
  if (typeof requirement !== 'string') return null;
  const separators = new Set([' ', '[', '<', '>', '=', '!', '~', ';', '@']);
  let end = requirement.length;
  for (let index = 0; index < requirement.length; index += 1) {
    if (separators.has(requirement[index])) {
      end = index;
      break;
    }
  }
  return requirement.slice(0, end).trim().toLowerCase().replaceAll('_', '-');
}

function projectDevDependencies(project) {
  const dependencies = project.project?.['optional-dependencies']?.dev;
  return Array.isArray(dependencies)
    ? dependencies.map(dependencyName).filter(Boolean)
    : [];
}

function lockPackage(lock, name) {
  return Array.isArray(lock.package)
    ? lock.package.find((entry) => entry?.name === name)
    : undefined;
}

function lockDevDependencies(lock, projectName) {
  const project = lockPackage(lock, projectName);
  const dependencies = project?.['optional-dependencies']?.dev;
  return Array.isArray(dependencies)
    ? dependencies.map((entry) => entry?.name).filter(Boolean)
    : [];
}

const protocolPackage = readJson(resolve(workspace, 'protocol', 'package.json'));
if (
  protocolPackage.scripts?.['gen:py']
  || protocolPackage.scripts?.['gen:cs']
  || /\bgen:(?:py|cs)\b/u.test(protocolPackage.scripts?.['gen:all'] ?? '')
) {
  throw new Error('Protocol must not retain Audio legacy Python/C# generator commands');
}

const cognitionProjectPath = resolve(workspace, 'core', 'cognition', 'pyproject.toml');
const audioProjectPath = resolve(workspace, 'engines', 'audio', 'pyproject.toml');
const cognitionLockPath = resolve(workspace, 'core', 'cognition', 'uv.lock');
const audioLockPath = resolve(workspace, 'engines', 'audio', 'uv.lock');
const cognitionProject = readToml(cognitionProjectPath, 'Cognition project');
const audioProject = readToml(audioProjectPath, 'Audio project');
const cognitionLock = readToml(cognitionLockPath, 'Cognition lock');
const audioLock = readToml(audioLockPath, 'Audio lock');

if (projectDevDependencies(cognitionProject).includes(GENERATOR_PACKAGE)) {
  throw new Error('Cognition must not retain the Audio legacy generator tool dependency');
}
if (projectDevDependencies(audioProject).includes(GENERATOR_PACKAGE)) {
  throw new Error('Audio must not retain the legacy generator tool dependency');
}
if (lockPackage(cognitionLock, GENERATOR_PACKAGE)
  || lockDevDependencies(cognitionLock, COGNITION_PROJECT).includes(GENERATOR_PACKAGE)) {
  throw new Error('Cognition lock must not retain the Audio legacy generator tool dependency');
}
if (lockPackage(audioLock, GENERATOR_PACKAGE)
  || lockDevDependencies(audioLock, AUDIO_PROJECT).includes(GENERATOR_PACKAGE)) {
  throw new Error('Audio lock must not retain the legacy generator tool dependency');
}

console.log('contracts inventory: ok');
