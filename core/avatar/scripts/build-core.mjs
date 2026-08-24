import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dotnet = process.env.DOTNET_EXE || path.join(
  repoRoot, 'contracts', '.tools', 'dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet',
);
if (!existsSync(dotnet)) throw new Error(`[avatar-core] 缺少固定 .NET SDK: ${dotnet}`);

const coreProject = path.join(repoRoot, 'core', 'avatar', 'GlimmerCradle.Avatar.Core.csproj');
const contractProject = path.join(repoRoot, 'contracts', 'csharp', 'GlimmerCradle.Avatar.Contracts.csproj');
const stageDirectory = path.join(repoRoot, 'build', 'components', 'avatar', 'core', 'netstandard2.1');
const pluginDirectory = path.join(repoRoot, 'hosts', 'unity-avatar-host', 'Assets', 'Plugins', 'GlimmerCradle');

await run(dotnet, ['build', coreProject, '--configuration', 'Release', '-p:RestoreLockedMode=true']);
await run(dotnet, ['build', contractProject, '--configuration', 'Release', '-p:RestoreLockedMode=true']);

const sources = [
  path.join(repoRoot, 'core', 'avatar', 'bin', 'Release', 'netstandard2.1', 'GlimmerCradle.Avatar.Core.dll'),
  path.join(repoRoot, 'contracts', 'csharp', 'bin', 'Release', 'netstandard2.1', 'GlimmerCradle.Avatar.Contracts.dll'),
  await resolveNugetAssembly(dotnet, 'google.protobuf', '3.33.0', 'lib', 'netstandard2.0', 'Google.Protobuf.dll'),
  await resolveNugetAssembly(dotnet, 'grpc.core.api', '2.46.6', 'lib', 'netstandard2.0', 'Grpc.Core.Api.dll'),
  await resolveNugetAssembly(dotnet, 'grpc.core', '2.46.6', 'lib', 'netstandard2.0', 'Grpc.Core.dll'),
];
await fs.mkdir(stageDirectory, { recursive: true });
await fs.mkdir(pluginDirectory, { recursive: true });
for (const source of sources) {
  await fs.copyFile(source, path.join(stageDirectory, path.basename(source)));
  await fs.copyFile(source, path.join(pluginDirectory, path.basename(source)));
}
if (process.platform === 'win32') {
  const nativeSource = await resolveNugetAssembly(
    dotnet,
    'grpc.core',
    '2.46.6',
    'runtimes',
    'win-x64',
    'native',
    'grpc_csharp_ext.x64.dll',
  );
  const nativeStageDirectory = path.join(stageDirectory, 'native', 'win-x64');
  const nativePluginDirectory = path.join(
    repoRoot,
    'hosts',
    'unity-avatar-host',
    'Assets',
    'Plugins',
    'AvatarPlugins',
    'x86_64',
  );
  await fs.mkdir(nativeStageDirectory, { recursive: true });
  await fs.mkdir(nativePluginDirectory, { recursive: true });
  await fs.copyFile(nativeSource, path.join(nativeStageDirectory, path.basename(nativeSource)));
  await fs.copyFile(nativeSource, path.join(nativePluginDirectory, path.basename(nativeSource)));
}
console.log(`[avatar-core] 已生成离线程序集并投影到 Unity Host: ${stageDirectory}`);

async function resolveNugetAssembly(command, ...segments) {
  const output = await capture(command, ['nuget', 'locals', 'global-packages', '--list']);
  const separator = output.indexOf(':');
  if (separator < 0) throw new Error(`[avatar-core] 无法解析 NuGet global-packages: ${output}`);
  const candidate = path.join(output.slice(separator + 1).trim(), ...segments);
  if (!existsSync(candidate)) throw new Error(`[avatar-core] 缺少锁定 NuGet 程序集: ${candidate}`);
  return candidate;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`[avatar-core] ${command} 退出码: ${code}`)));
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`[avatar-core] ${command} 退出码: ${code}`)));
  });
}
