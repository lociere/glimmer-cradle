import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const project = resolve(root, 'tests/csharp/GlimmerCradle.Contracts.Roundtrip.csproj');
const localDotnet = resolve(root, '.tools/dotnet/dotnet.exe');
const dotnet = process.env.DOTNET_EXE || (existsSync(localDotnet) ? localDotnet : 'dotnet');

function run(args) {
  const result = spawnSync(dotnet, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CONTRACTS_ROOT: root,
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['restore', project, '--locked-mode']);
run(['run', '--project', project, '--no-restore']);
