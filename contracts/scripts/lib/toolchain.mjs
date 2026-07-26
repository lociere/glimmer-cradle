import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

export function readToolchain(root) {
  return JSON.parse(readFileSync(resolve(root, 'toolchain.json'), 'utf8'));
}

export function assertExactVersion(label, output, expected, prefix = '') {
  const actual = output.trim();
  const expectedOutput = `${prefix}${expected}`;
  if (actual !== expectedOutput && !actual.startsWith(`${expectedOutput} `)) {
    throw new Error(`${label} version mismatch: expected ${expected}, got ${actual || '<empty>'}`);
  }
}

export function sha256(file) {
  if (!existsSync(file)) throw new Error(`pinned executable is missing: ${file}`);
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function assertFileSha256(label, file, expected) {
  const actual = sha256(file);
  if (actual !== expected.toLowerCase()) {
    throw new Error(`${label} SHA256 mismatch: expected ${expected.toLowerCase()}, got ${actual}`);
  }
}

export function assertPackageMetadata(label, actual, expected) {
  if (actual.version !== expected.version || actual.license !== expected.license) {
    throw new Error(
      `installed metadata mismatch for ${label}: `
      + `expected ${expected.version} / ${expected.license}, got ${actual.version} / ${actual.license}`,
    );
  }
}

function runVersion(label, executable, args) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    throw new Error(`${label} is unavailable at ${executable}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} version check failed with exit ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function pinnedPlatform(toolchain, tool) {
  const key = platformKey();
  const pinned = toolchain[tool].platforms[key];
  if (!pinned) throw new Error(`${tool} has no pinned archive evidence for supported platform ${key}`);
  return pinned;
}

export function verifyUv(root, environment = process.env) {
  const toolchain = readToolchain(root);
  const pinned = pinnedPlatform(toolchain, 'uv');
  const local = resolve(root, '.tools', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv');
  const explicit = environment.UV_EXE;
  const executable = explicit || (existsSync(local) ? local : (process.platform === 'win32' ? 'uv.exe' : 'uv'));
  assertExactVersion('uv', runVersion('uv', executable, ['--version']), toolchain.uv.version, 'uv ');
  if (explicit || executable === local) assertFileSha256('uv launcher', executable, pinned.launcher_sha256);
  return executable;
}

export function verifyDotnet(root, environment = process.env) {
  const toolchain = readToolchain(root);
  const pinned = pinnedPlatform(toolchain, 'dotnet');
  const local = resolve(root, '.tools', 'dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  const explicit = environment.DOTNET_EXE;
  const executable = explicit || (existsSync(local) ? local : (process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'));
  assertExactVersion('.NET SDK', runVersion('.NET SDK', executable, ['--version']), toolchain.dotnet.version);
  if (explicit || executable === local) assertFileSha256('.NET launcher', executable, pinned.launcher_sha256);
  return executable;
}
