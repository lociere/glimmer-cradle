#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const output = process.env.GLIMMER_CRADLE_IMAGE_OUTPUT || 'type=oci,dest=build/staging/personal-server/linux-amd64/image-archive.tar';
const baseImages = ['NODE_IMAGE', 'PYTHON_IMAGE', 'UV_IMAGE'];
for (const name of baseImages) {
  if (!process.env[name]?.includes('@sha256:')) throw new Error(`${name} 必须是 digest 固定引用`);
}
const args = [
  'buildx', 'build', '--platform', 'linux/amd64', '--provenance=mode=max', '--sbom=true',
  '--file', 'deploy/personal-server/Dockerfile',
  ...baseImages.flatMap((name) => ['--build-arg', `${name}=${process.env[name]}`]),
  '--output', output, '.',
];
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify({ command: 'docker', args, side_effects: [] }, null, 2)}\n`);
} else {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`docker buildx 退出码 ${code}`)));
  });
}
