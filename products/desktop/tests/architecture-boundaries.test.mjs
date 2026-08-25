import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function* walkTypeScript(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkTypeScript(entryPath);
    else if (entry.isFile() && entry.name.endsWith('.ts')) yield entryPath;
  }
}

test('Desktop IPC 只通过 DesktopIpcRouter 注册', () => {
  const offenders = [];
  for (const filePath of walkTypeScript(path.join(productRoot, 'src', 'main'))) {
    const relativePath = path.relative(productRoot, filePath).replaceAll(path.sep, '/');
    if (relativePath === 'src/main/ipc/desktop-ipc-router.ts') continue;
    if (/ipcMain\.(?:handle|on)\s*\(/.test(fs.readFileSync(filePath, 'utf8'))) offenders.push(relativePath);
  }
  assert.deepEqual(offenders, []);
});

test('Desktop product manifest 保持稳定产品身份', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(productRoot, 'product.json'), 'utf8'));
  assert.equal(manifest.id, 'desktop');
  assert.equal(manifest.schema_version, 1);
});
