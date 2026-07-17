import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const defaultConfigRoot = '/opt/glimmer-cradle/default-config';
const configRoot = process.env.GLIMMER_CRADLE_CONFIG_ROOT || '/var/lib/glimmer-cradle/config';

await mkdir(configRoot, { recursive: true });
await seedMissingFiles(defaultConfigRoot, configRoot);
await import('./supervisor.mjs');

async function seedMissingFiles(sourceRoot, targetRoot) {
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true });
      await seedMissingFiles(source, target);
      continue;
    }
    if (entry.isFile()) {
      await cp(source, target, { errorOnExist: false, force: false });
    }
  }
}
