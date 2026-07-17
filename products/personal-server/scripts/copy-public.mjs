import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(packageRoot, 'dist', 'public');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(path.join(packageRoot, 'public'), target, { recursive: true });
