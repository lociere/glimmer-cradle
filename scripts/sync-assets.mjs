/**
 * 把只读发布资产域投影到 Desktop renderer public 目录。
 *
 * 通用资源随客户端发布；角色身体资产必须先通过 Avatar Package catalog 投影，
 * 再进入 renderer public。未注册身体资产包与未引用的资源不会进入 Desktop 产物。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAvatarPackageCatalog,
  resolveRepositoryAssetPath,
} from './lib/avatar-package-catalog.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repoRoot, 'assets');
const avatarSource = path.join(source, 'avatar');
const target = path.join(
  repoRoot,
  'products',
  'desktop',
  'src',
  'renderer',
  'public',
  'assets',
);

const sourceStat = await fs.stat(source).catch(() => null);
if (!sourceStat?.isDirectory()) {
  throw new Error(`[sync-assets] 发布资产目录不存在: ${source}`);
}

const avatarCatalog = await loadAvatarPackageCatalog(repoRoot);
const publicCatalog = {
  $schema: './avatar-packages.schema.json',
  defaultAvatarPackageId: avatarCatalog.defaultAvatarPackageId,
  defaultModelId: avatarCatalog.defaultModelId,
  packages: avatarCatalog.packages.map((item) => ({
    id: item.id,
    default: item.default,
    characterId: item.characterId,
    modelId: item.modelId,
    displayName: item.displayName,
    kind: item.kind,
    preferredBackend: item.preferredBackend,
    previewImagePath: item.previewImagePath || undefined,
    live2dVersion: item.live2dVersion,
    presentation: item.presentation,
    scaleFactor: item.scaleFactor,
    license: item.license,
  })),
};
const avatarMetadataPaths = [
  path.join(avatarSource, 'avatar-packages.schema.json'),
];
const publishedAvatarPaths = [];
for (const avatarPackage of avatarCatalog.packages) {
  if (avatarPackage.previewImagePath) {
    publishedAvatarPaths.push(
      resolveRepositoryAssetPath(repoRoot, avatarPackage.previewImagePath, `${avatarPackage.id}.previewImagePath`),
    );
  }
}

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
const sourceEntries = await fs.readdir(source, { withFileTypes: true });
for (const entry of sourceEntries) {
  if (entry.name === 'avatar' || entry.name === 'cubism') continue;
  const entrySource = path.join(source, entry.name);
  const entryTarget = path.join(target, entry.name);
  if (entry.isDirectory()) {
    await fs.cp(entrySource, entryTarget, { recursive: true });
  } else if (entry.isFile()) {
    await fs.copyFile(entrySource, entryTarget);
  }
}
for (const assetPath of [...avatarMetadataPaths, ...publishedAvatarPaths]) {
  await copyPublishedAsset(assetPath);
}
await fs.mkdir(path.join(target, 'avatar'), { recursive: true });
await fs.writeFile(
  path.join(target, 'avatar', 'avatar-packages.json'),
  `${JSON.stringify(publicCatalog, null, 2)}\n`,
  'utf8',
);
console.log('[sync-assets] Desktop 发布资产投影已重建');

async function copyPublishedAsset(assetPath) {
  const relative = path.relative(source, assetPath);
  const destination = path.join(target, relative);
  const stat = await fs.stat(assetPath).catch(() => null);
  if (!stat) {
    throw new Error(`[sync-assets] catalog 声明的发布资产不存在: ${assetPath}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (stat.isDirectory()) {
    await fs.cp(assetPath, destination, { recursive: true });
  } else {
    await fs.copyFile(assetPath, destination);
  }
}
