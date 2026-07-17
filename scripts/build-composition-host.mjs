import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = path.join(repoRoot, 'build', 'components', 'native', 'composition-host', 'windows-x64');
const pluginDirectory = path.join(
  repoRoot,
  'core',
  'avatar',
  'unity-host',
  'Assets',
  'Plugins',
  'AvatarPlugins',
  'x86_64',
);
const binaryName = process.platform === 'win32' ? 'platform_native.dll' : 'libplatform_native.so';

if (process.platform !== 'win32') {
  console.log('[composition-host] 当前平台没有需要构建的桌面合成适配器');
  process.exit(0);
}

const cmake = process.env.CMAKE_COMMAND || 'cmake';
await fs.mkdir(buildDirectory, { recursive: true });
await run(cmake, ['-S', path.join(repoRoot, 'native'), '-B', buildDirectory, '-A', 'x64']);
await run(cmake, ['--build', buildDirectory, '--config', 'Release']);

const candidates = [
  path.join(buildDirectory, 'bin', binaryName),
  path.join(buildDirectory, 'bin', 'Release', binaryName),
  path.join(buildDirectory, 'Release', binaryName),
];
const binary = candidates.find((candidate) => existsSync(candidate));
if (!binary) {
  throw new Error(`[composition-host] 未找到构建产物: ${candidates.join(', ')}`);
}

await fs.mkdir(pluginDirectory, { recursive: true });
await fs.copyFile(binary, path.join(pluginDirectory, binaryName));
console.log(`[composition-host] 已投影平台合成适配器: ${path.join(pluginDirectory, binaryName)}`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[composition-host] ${command} 退出码: ${code}`));
    });
  });
}
