import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extract } from 'tar';

const LINK_ENTRY_TYPES = new Set(['Link', 'SymbolicLink']);

export async function projectUnityPackage({ packagePath, projectPath, projectionScopes }) {
  const normalizedScopes = normalizeProjectionScopes(projectionScopes);
  const projectRoot = path.resolve(projectPath);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-cradle-unitypackage-'));

  try {
    await extract({
      file: packagePath,
      cwd: temporaryRoot,
      strict: true,
      preservePaths: false,
      filter: (_entryPath, entry) => {
        if (LINK_ENTRY_TYPES.has(entry.type)) {
          throw new Error(`[avatar:sdk] Unity package 不允许链接条目: ${entry.path}`);
        }
        return true;
      },
    });

    const entries = await readPackageEntries(temporaryRoot, projectRoot, normalizedScopes);
    if (entries.length === 0) {
      throw new Error('[avatar:sdk] Unity package 未包含声明范围内的资产');
    }

    for (const scope of normalizedScopes) {
      const target = resolveProjectAssetPath(projectRoot, scope.path);
      await fs.rm(target, { recursive: scope.kind === 'tree', force: true });
      await fs.rm(`${target}.meta`, { force: true });
    }

    for (const entry of entries.sort((left, right) => left.assetPath.localeCompare(right.assetPath))) {
      await installEntry(entry);
    }

    return { count: entries.length, projectionScopes: normalizedScopes };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function readPackageEntries(temporaryRoot, projectRoot, projectionScopes) {
  const directoryEntries = await fs.readdir(temporaryRoot, { withFileTypes: true });
  const projectedEntries = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory()) continue;
    const sourceDirectory = path.join(temporaryRoot, directoryEntry.name);
    const pathnameFile = path.join(sourceDirectory, 'pathname');

    let assetPath;
    try {
      assetPath = normalizeAssetPath(await fs.readFile(pathnameFile, 'utf8'), 'pathname');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    if (!projectionScopes.some((scope) => scopeContains(scope, assetPath))) {
      throw new Error(`[avatar:sdk] Unity package 资产越过允许投影范围: ${assetPath}`);
    }

    const targetPath = resolveProjectAssetPath(projectRoot, assetPath);
    const assetSource = path.join(sourceDirectory, 'asset');
    const metadataSource = path.join(sourceDirectory, 'asset.meta');
    projectedEntries.push({
      assetPath,
      targetPath,
      assetSource: await isFile(assetSource) ? assetSource : null,
      metadataSource: await isFile(metadataSource) ? metadataSource : null,
    });
  }

  return projectedEntries;
}

async function installEntry(entry) {
  if (entry.assetSource) {
    await fs.mkdir(path.dirname(entry.targetPath), { recursive: true });
    await fs.copyFile(entry.assetSource, entry.targetPath);
  } else {
    await fs.mkdir(entry.targetPath, { recursive: true });
  }

  if (entry.metadataSource) {
    await fs.mkdir(path.dirname(`${entry.targetPath}.meta`), { recursive: true });
    await fs.copyFile(entry.metadataSource, `${entry.targetPath}.meta`);
  }
}

function normalizeAssetPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[avatar:sdk] ${fieldName} 不能为空`);
  }
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (
    path.posix.isAbsolute(normalized)
    || !normalized.startsWith('Assets/')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`[avatar:sdk] ${fieldName} 不是合法的 Unity 资产路径: ${value.trim()}`);
  }
  return normalized;
}

function normalizeProjectionScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error('[avatar:sdk] projectionScopes 必须声明至少一个投影范围');
  }
  return scopes.map((scope, index) => {
    if (!scope || (scope.kind !== 'tree' && scope.kind !== 'file')) {
      throw new Error(`[avatar:sdk] projectionScopes[${index}].kind 必须是 tree 或 file`);
    }
    return {
      kind: scope.kind,
      path: normalizeAssetPath(scope.path, `projectionScopes[${index}].path`),
    };
  });
}

function scopeContains(scope, assetPath) {
  return assetPath === scope.path
    || (scope.kind === 'tree' && assetPath.startsWith(`${scope.path}/`));
}

function resolveProjectAssetPath(projectRoot, assetPath) {
  const resolved = path.resolve(projectRoot, ...assetPath.split('/'));
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`[avatar:sdk] Unity package 投影路径越界: ${assetPath}`);
  }
  return resolved;
}

async function isFile(candidate) {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
