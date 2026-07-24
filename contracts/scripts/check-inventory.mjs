import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inventory = readFileSync(resolve(import.meta.dirname, '..', 'inventory.md'), 'utf8');
const required = [
  'protocol/src/schemas/',
  'protocol/src/generated/',
  'core/cognition/src/glimmer_cradle/cognition/protocol/generated/',
  'core/avatar/unity-host/Assets/Scripts/Avatar/Contracts/PresentationFrames.g.cs',
  '配置 consumers',
  'SDK consumers',
  'validator',
  'build',
  'package',
  'owner',
  '迁移切片',
  '删除条件',
];

const missing = required.filter((text) => !inventory.includes(text));
if (missing.length > 0) {
  throw new Error(`contracts inventory missing required terms: ${missing.join(', ')}`);
}

console.log('contracts inventory: ok');
