import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAvatarPackageCatalog } from './lib/avatar-package-catalog.mjs';
import { resolveAvatarSdkCatalogPath } from './lib/avatar-paths.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkCatalogPath = resolveAvatarSdkCatalogPath(repoRoot);
const checkOnly = process.argv.includes('--check');

const avatarCatalog = await loadAvatarPackageCatalog(repoRoot);
const sdkCatalog = JSON.parse(await fs.readFile(sdkCatalogPath, 'utf8'));
const requiredModelFormats = new Set(
  avatarCatalog.packages
    .filter((avatarPackage) => avatarPackage.preferredBackend === 'unity')
    .map((avatarPackage) => avatarPackage.live2dVersion)
    .filter(Boolean),
);

const requiredSdks = new Map();
for (const modelFormat of requiredModelFormats) {
  const descriptor = sdkCatalog.sdks?.find(
    (sdk) => Array.isArray(sdk.modelFormats) && sdk.modelFormats.includes(modelFormat),
  );
  if (!descriptor) {
    fail([`Unity SDK catalog 未声明模型格式 ${modelFormat} 所需的 SDK`]);
  }
  requiredSdks.set(descriptor.id, descriptor);
}

for (const descriptor of requiredSdks.values()) {
  const displayName = descriptor.displayName || descriptor.id;
  const sourceOverride = descriptor.sourceEnv ? process.env[descriptor.sourceEnv] : undefined;
  const sourcePath = resolveRepositoryOrAbsolutePath(sourceOverride || descriptor.sourcePath, 'sourcePath');
  const targetPath = resolveRepositoryPath(descriptor.targetPath, 'targetPath');
  const extensions = new Set(descriptor.artifactExtensions ?? []);
  const installMode = descriptor.installMode ?? 'copy';

  if (!(await exists(sourcePath))) {
    fail([
      `未找到 Avatar SDK: ${displayName}`,
      descriptor.status ? `兼容状态: ${descriptor.status}` : '',
      `默认目录: ${sourcePath}`,
      descriptor.sourceEnv ? `也可以设置 ${descriptor.sourceEnv} 指向本机 SDK 目录。` : '',
      descriptor.installHint || '该目录属于本机第三方包，不提交 Git。',
      descriptor.licenseNote || '',
    ].filter(Boolean));
  }

  const sdkFiles = await collectSdkFiles(sourcePath, extensions);
  if (sdkFiles.length === 0) {
    fail([
      `Avatar SDK ${displayName} 中没有发现 catalog 声明的代码或程序集文件。`,
      `检查目录: ${sourcePath}`,
      descriptor.installHint || '',
    ]);
  }

  console.log(`[avatar:sdk] ${displayName} 已发现，共 ${sdkFiles.length} 个 artifact`);
  if (!checkOnly) {
    if (installMode === 'unitypackage') {
      if (sdkFiles.length !== 1) {
        fail([`${displayName} 必须且只能提供一个 .unitypackage，当前发现 ${sdkFiles.length} 个。`]);
      }
      validateProjectionScopes(descriptor.projectionScopes);
      console.log(`[avatar:sdk] ${displayName} 安装包已准备，将在 avatar:build 时投影到 Unity 工程`);
      continue;
    }
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(sourcePath, targetPath, { recursive: true });
    console.log(`[avatar:sdk] ${displayName} 已同步到 Unity`);
  }
}

async function exists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function collectSdkFiles(directory, extensions) {
  const found = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await collectSdkFiles(entryPath, extensions));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      found.push(entryPath);
    }
  }
  return found;
}

function resolveRepositoryOrAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail([`Avatar SDK catalog 的 ${fieldName} 不能为空`]);
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function resolveRepositoryPath(value, fieldName) {
  const resolved = resolveRepositoryOrAbsolutePath(value, fieldName);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail([`Avatar SDK catalog 的 ${fieldName} 越过仓库边界: ${value}`]);
  }
  return resolved;
}

function resolveUnityAssetPath(value, fieldName) {
  const normalized = typeof value === 'string' ? value.replaceAll('\\', '/') : '';
  const segments = normalized.split('/');
  if (
    !normalized.startsWith('Assets/')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail([`Avatar SDK catalog 的 ${fieldName} 必须是 Assets/ 下的 Unity 资产路径`]);
  }
  const resolved = path.resolve(resolveRepositoryPath('core/avatar/unity-host', 'unityProject'), ...segments);
  const projectRoot = resolveRepositoryPath('core/avatar/unity-host', 'unityProject');
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail([`Avatar SDK catalog 的 ${fieldName} 越过 Unity 工程边界: ${normalized}`]);
  }
  return resolved;
}

function validateProjectionScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    fail(['Avatar SDK catalog 的 projectionScopes 必须声明至少一个投影范围']);
  }
  for (const [index, scope] of scopes.entries()) {
    if (!scope || !['tree', 'file'].includes(scope.kind)) {
      fail([`Avatar SDK catalog 的 projectionScopes[${index}].kind 必须是 tree 或 file`]);
    }
    resolveUnityAssetPath(scope.path, `projectionScopes[${index}].path`);
  }
}

function fail(lines) {
  for (const line of lines) {
    console.error(`[avatar:sdk] ${line}`);
  }
  process.exit(2);
}
