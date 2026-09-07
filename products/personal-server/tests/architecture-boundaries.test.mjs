import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function* walkFiles(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(entryPath);
    else if (entry.isFile()) yield entryPath;
  }
}

test('Personal Server public 不恢复单体浏览器业务入口', () => {
  const offenders = [...walkFiles(path.join(productRoot, 'public'))]
    .map((filePath) => path.relative(productRoot, filePath).replaceAll(path.sep, '/'))
    .filter((relativePath) => relativePath !== 'public/index.html')
    .filter((relativePath) => /\.(?:js|jsx|ts|tsx|css|scss|sass|less)$/i.test(relativePath));
  assert.deepEqual(offenders, []);
});

test('Personal Server server/web 物理边界保持单向跨边界调用', () => {
  const checks = [
    ['src/server', /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*(?:\/src\/web\/|\.\.\/(?:\.\.\/)*web\/)/],
    ['src/web', /(?:from\s+|import\s*\(|require\s*\()\s*['"][^'"]*(?:\/src\/server\/|\.\.\/(?:\.\.\/)*server\/)/],
  ];
  for (const [relativeRoot, pattern] of checks) {
    const offenders = [...walkFiles(path.join(productRoot, relativeRoot))]
      .filter((filePath) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(filePath))
      .filter((filePath) => pattern.test(fs.readFileSync(filePath, 'utf8')))
      .map((filePath) => path.relative(productRoot, filePath).replaceAll(path.sep, '/'));
    assert.deepEqual(offenders, []);
  }
});

test('Personal Server 产品组合不投影 Desktop 本机能力', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(productRoot, 'product.json'), 'utf8'));
  assert.equal(manifest.id, 'personal-server');
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.features.avatar, false);
  assert.equal(manifest.features.local_device_actions, false);
  assert.equal(manifest.features.audio.asr, false);
  assert.equal(manifest.features.audio.tts, true);
});

test('Personal Server web composition 入口不重新膨胀为 owner 混合单体', () => {
  const limits = [
    ['src/web/app/bootstrap.tsx', 6500],
    ['src/web/app/PersonalServerAppController.ts', 24000],
    ['src/web/features/configuration/ConfigurationController.ts', 20000],
  ];
  for (const [relativePath, maxBytes] of limits) {
    assert.ok(fs.statSync(path.join(productRoot, relativePath)).size <= maxBytes, relativePath);
  }
});

test('Personal Server React Shell 与 Router 保持唯一 owner，旧入口不回流', () => {
  const removedPaths = [
    'src/web/main.ts',
    'src/web/app/bootstrap.ts',
    'src/web/app/router.ts',
    'src/web/shell/layout.ts',
    'src/web/routes/LegacyRouteMount.tsx',
    'src/web/features/status/status-view.ts',
    'src/web/features/status/status.css',
    'src/web/features/conversation/conversation-view.ts',
    'src/web/features/conversation/conversation.css',
    'src/web/features/extensions/extension-view.ts',
    'src/web/features/extensions/extensions.css',
    'src/web/features/observability/observability-view.ts',
    'src/web/features/observability/observability.css',
    'src/web/features/extensions',
    'src/web/features/configuration/configuration-view.ts',
    'src/web/features/configuration/configuration.css',
    'src/web/features/configuration/configuration-system-bindings.ts',
    'src/web/features/configuration/configuration-supplemental-state.ts',
  ];
  for (const relativePath of removedPaths) {
    assert.equal(fs.existsSync(path.join(productRoot, relativePath)), false, relativePath);
  }
  assert.equal(fs.existsSync(path.join(productRoot, 'src/web/app/router.tsx')), true);

  const webFiles = [...walkFiles(path.join(productRoot, 'src', 'web'))]
    .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath));
  const source = webFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
  assert.equal((source.match(/createRoot\s*\(/g) ?? []).length, 1);
  assert.equal((source.match(/<BrowserRouter>/g) ?? []).length, 1);
  assert.deepEqual(
    ['/conversation', '/overview', '/capabilities', '/activity', '/settings']
      .filter((route) => !source.includes(route)),
    [],
  );

  const shellAndRoutes = webFiles
    .filter((filePath) => /[\\/](?:app|shell|routes)[\\/]/.test(filePath))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  assert.doesNotMatch(shellAndRoutes, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /mountOverview\s*\(|\bStatusView\b/);
  assert.doesNotMatch(source, /mountConversation\s*\(|\bConversationView\b/);
  assert.doesNotMatch(source, /mountCapabilities\s*\(|\bExtensionView\b/);
  assert.doesNotMatch(source, /mountSettings\s*\(|\bConfigurationView\b/);
  assert.doesNotMatch(source, /mountActivity\s*\(|\bObservabilityView\b/);
});
