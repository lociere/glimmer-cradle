import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function buildPlatformProcessTreeBridge() {
  if (process.platform !== 'win32') return null;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const sourceRoot = path.join(repoRoot, 'core/platform/native');
  const buildRoot = path.join(repoRoot, 'build/native/platform-process-tree-bridge/windows-x64');
  const outputRoot = path.join(repoRoot, 'build/components/native/composition-host/windows-x64');
  const output = path.join(outputRoot, 'PlatformProcessTreeBridge.exe');
  await mkdir(outputRoot, { recursive: true });
  await run('cmake', ['-S', sourceRoot, '-B', buildRoot, '-A', 'x64'], repoRoot);
  await run('cmake', ['--build', buildRoot, '--config', 'Release'], repoRoot);
  const built = ['bin/Release', 'bin', 'Release'].map(dir => path.join(buildRoot, dir, 'PlatformProcessTreeBridge.exe')).find(existsSync);
  if (!built) throw new Error('Platform process-tree native artifact is missing');
  await copyFile(built, output);
  return output;
}
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exit code ' + code)));
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await buildPlatformProcessTreeBridge();
  process.stdout.write(JSON.stringify({ event: 'platform_process_tree_bridge_built', output }) + '\n');
}
