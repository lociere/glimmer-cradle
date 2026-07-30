#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
await access(path.join(repoRoot, 'core', 'avatar', 'scripts', 'build-core.mjs'));
const catalog = JSON.parse(await readFile(path.join(repoRoot, 'assets', 'avatar', 'avatar-packages', 'catalog.json'), 'utf8').catch(() => '{"packages":[]}'));
if (!Array.isArray(catalog.packages)) throw new Error('Avatar Package catalog 无效');
process.stdout.write(`${JSON.stringify({ event: 'avatar_core_verified', packages: catalog.packages.length })}\n`);
