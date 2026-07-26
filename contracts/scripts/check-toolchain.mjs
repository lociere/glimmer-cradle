import { createRequire } from 'node:module';
import {
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  assertPackageMetadata,
  platformKey,
  readToolchain,
  verifyDotnet,
  verifyUv,
} from './lib/toolchain.mjs';

const root = resolve(import.meta.dirname, '..');
const workspace = resolve(root, '..');
const manifest = readToolchain(root);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const rootLock = readFileSync(resolve(workspace, 'pnpm-lock.yaml'), 'utf8');
const supplyChain = readFileSync(resolve(root, 'supply-chain.md'), 'utf8');

if (manifest.schema_version !== 'contracts.toolchain.v1') {
  throw new Error(`unsupported contracts toolchain manifest: ${manifest.schema_version}`);
}

function lockEntry(name, version) {
  const locator = `${name}@${version}`;
  const quoted = `\n  '${locator}':`;
  const plain = `\n  ${locator}:`;
  const index = rootLock.indexOf(quoted) >= 0 ? rootLock.indexOf(quoted) : rootLock.indexOf(plain);
  if (index < 0) throw new Error(`pnpm lock is missing ${locator}`);
  const remainder = rootLock.slice(index + 3);
  const nextEntry = remainder.search(/\n  ['@A-Za-z0-9]/u);
  const end = nextEntry < 0 ? undefined : index + 3 + nextEntry;
  return rootLock.slice(index, end < 0 ? undefined : end);
}

function findPackageJson(entry, expectedName) {
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    const candidate = resolve(directory, 'package.json');
    if (existsSync(candidate)) {
      const json = JSON.parse(readFileSync(candidate, 'utf8'));
      if (json.name === expectedName) return candidate;
    }
    directory = dirname(directory);
  }
  throw new Error(`cannot locate package.json for ${expectedName}`);
}

function resolvePackageJson(name, relationship) {
  const direct = resolve(root, 'node_modules', ...name.split('/'), 'package.json');
  if (existsSync(direct)) return realpathSync(direct);

  const parentName = relationship === 'transitive' ? '@bufbuild/protoc-gen-es' : '@bufbuild/buf';
  const parentManifest = realpathSync(resolve(root, 'node_modules', ...parentName.split('/'), 'package.json'));
  const requireFromParent = createRequire(parentManifest);
  try {
    return realpathSync(requireFromParent.resolve(`${name}/package.json`));
  } catch {
    return findPackageJson(realpathSync(requireFromParent.resolve(name)), name);
  }
}

const directVersions = new Map([
  ...Object.entries(packageJson.dependencies ?? {}),
  ...Object.entries(packageJson.devDependencies ?? {}),
]);
const currentPlatform = platformKey();

for (const dependency of manifest.npm_packages) {
  const entry = lockEntry(dependency.name, dependency.version);
  if (!entry.includes(`integrity: ${dependency.integrity}`)) {
    throw new Error(`pnpm lock integrity mismatch for ${dependency.name}@${dependency.version}`);
  }
  if (dependency.relationship === 'direct' && directVersions.get(dependency.name) !== dependency.version) {
    throw new Error(`contracts package version mismatch for ${dependency.name}: expected ${dependency.version}`);
  }
  if (!dependency.platform || dependency.platform === currentPlatform) {
    const installed = JSON.parse(readFileSync(resolvePackageJson(dependency.name, dependency.relationship), 'utf8'));
    assertPackageMetadata(dependency.name, installed, dependency);
  }
  if (!/^https:\/\//u.test(dependency.source)) {
    throw new Error(`supply-chain source must use HTTPS for ${dependency.name}`);
  }
  for (const evidence of [dependency.name, dependency.version, dependency.license, dependency.source]) {
    if (!supplyChain.includes(evidence)) throw new Error(`supply-chain.md is missing ${dependency.name} evidence: ${evidence}`);
  }
}

const globalJson = JSON.parse(readFileSync(resolve(root, 'global.json'), 'utf8'));
if (
  globalJson.sdk?.version !== manifest.dotnet.version
  || globalJson.sdk?.rollForward !== 'disable'
  || globalJson.sdk?.allowPrerelease !== false
) {
  throw new Error('contracts/global.json must pin the exact stable .NET SDK with rollForward disabled');
}

for (const [tool, hashKey, hashLength] of [['uv', 'archive_sha256', 64], ['dotnet', 'archive_sha512', 128]]) {
  for (const [platform, evidence] of Object.entries(manifest[tool].platforms)) {
    if (!/^https:\/\//u.test(evidence.url)) throw new Error(`${tool} ${platform} archive URL must use HTTPS`);
    if (!new RegExp(`^[a-f0-9]{${hashLength}}$`, 'u').test(evidence[hashKey])) {
      throw new Error(`${tool} ${platform} has invalid ${hashKey}`);
    }
    if (!/^[a-f0-9]{64}$/u.test(evidence.launcher_sha256)) {
      throw new Error(`${tool} ${platform} has invalid launcher_sha256`);
    }
  }
}

for (const [name, evidence] of [
  ['uv', { ...manifest.uv, source: manifest.uv.release }],
  ['.NET SDK', { ...manifest.dotnet, source: manifest.dotnet.release_metadata }],
  ['Python protobuf', manifest.language_packages.python_protobuf],
  ['Google.Protobuf', manifest.language_packages.google_protobuf],
]) {
  for (const value of [evidence.version, evidence.license, evidence.source]) {
    if (!value || !supplyChain.includes(value)) {
      throw new Error(`supply-chain.md is missing ${name} evidence: ${value ?? '<missing>'}`);
    }
  }
}

const pythonProject = readFileSync(resolve(root, 'tests/python/pyproject.toml'), 'utf8');
const pythonLock = readFileSync(resolve(root, 'tests/python/uv.lock'), 'utf8');
const pythonVersion = manifest.language_packages.python_protobuf.version;
if (
  !pythonProject.includes(`protobuf==${pythonVersion}`)
  || !pythonLock.includes(`version = "${pythonVersion}"`)
  || !pythonLock.includes('hash = "sha256:')
) {
  throw new Error(`Python protobuf ${pythonVersion} is not fixed with hashed uv lock artifacts`);
}

const csharpProject = readFileSync(resolve(root, 'tests/csharp/GlimmerCradle.Contracts.Roundtrip.csproj'), 'utf8');
const csharpLock = JSON.parse(readFileSync(resolve(root, 'tests/csharp/packages.lock.json'), 'utf8'));
const csharpVersion = manifest.language_packages.google_protobuf.version;
const csharpLockedPackage = csharpLock.dependencies?.['net8.0']?.['Google.Protobuf'];
if (
  !csharpProject.includes(`Version="${csharpVersion}"`)
  || csharpLockedPackage?.resolved !== csharpVersion
  || !csharpLockedPackage.contentHash
) {
  throw new Error(`Google.Protobuf ${csharpVersion} is not fixed with a NuGet content hash`);
}

const uvExecutable = verifyUv(root);
const dotnetExecutable = verifyDotnet(root);
console.log(`contracts toolchain: ok (uv=${uvExecutable}, dotnet=${dotnetExecutable})`);
