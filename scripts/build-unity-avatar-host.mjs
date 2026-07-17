import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAvatarPackageCatalog } from './lib/avatar-package-catalog.mjs';
import { projectUnityPackage } from './lib/unitypackage-projector.mjs';
import {
  resolveAvatarSdkCatalogPath,
  resolveAvatarBuildLogPath,
  resolveAvatarUnityProjectPath,
  resolveManagedAvatarHostExecutablePath,
} from './lib/avatar-paths.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = resolveAvatarUnityProjectPath(repoRoot);
const outputPath = resolveManagedAvatarHostExecutablePath(repoRoot);
const logPath = resolveAvatarBuildLogPath(repoRoot);
const sdkCatalogPath = resolveAvatarSdkCatalogPath(repoRoot);
const sdkProjectionVersion = 1;

await fs.mkdir(path.dirname(logPath), { recursive: true });
await fs.writeFile(logPath, '', 'utf8');
await runNodeScript('sync-unity-assets.mjs');
await runNodeScript('sync-unity-avatar-sdk.mjs');
await runNodeScript('build-composition-host.mjs');
await projectRequiredUnityPackages();

const unityEditor = await resolveUnityEditor();
if (!unityEditor) {
  console.error('[avatar:build] 未找到 Unity Editor。请设置 UNITY_EDITOR 指向 Unity.exe。');
  process.exit(1);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const args = [
  '-batchmode',
  '-nographics',
  '-quit',
  '-projectPath',
  projectPath,
  '-executeMethod',
  'GlimmerCradle.Avatar.Editor.UnityAvatarHostBuild.BuildWindows',
  '-logFile',
  logPath,
];

const code = await runProcess(unityEditor, args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    GLIMMER_CRADLE_UNITY_AVATAR_HOST_OUTPUT: outputPath,
  },
});

if (code !== 0) {
  console.error(`[avatar:build] Unity 构建失败，详见 ${logPath}`);
  process.exit(code ?? 1);
}

await installNativeLauncher();
await normalizeGeneratedScene(path.join(projectPath, 'Assets', 'Scenes', 'UnityAvatarHost.unity'));
console.log(`[avatar:build] Unity Avatar 构建完成: ${outputPath}`);

async function installNativeLauncher() {
  if (process.platform !== 'win32') return;
  const buildRoot = path.join(repoRoot, 'build', 'components', 'native', 'composition-host', 'windows-x64');
  const candidates = [
    path.join(buildRoot, 'bin', 'UnityAvatarHostLauncher.exe'),
    path.join(buildRoot, 'bin', 'Release', 'UnityAvatarHostLauncher.exe'),
    path.join(buildRoot, 'Release', 'UnityAvatarHostLauncher.exe'),
  ];
  const launcher = candidates.find((candidate) => existsSync(candidate));
  if (!launcher) {
    throw new Error(`[avatar:build] 未找到 Avatar 原生启动器: ${candidates.join(', ')}`);
  }
  const target = path.join(path.dirname(outputPath), 'UnityAvatarHostLauncher.exe');
  await fs.copyFile(launcher, target);
  console.log(`[avatar:build] Avatar 原生启动器已安装: ${target}`);
}

async function runNodeScript(scriptName) {
  const scriptPath = path.join(repoRoot, 'scripts', scriptName);
  const code = await runProcess(process.execPath, [scriptPath], { cwd: repoRoot, env: process.env });
  if (code !== 0) {
    throw new Error(`[avatar:build] ${scriptName} failed with code ${code}`);
  }
}

async function normalizeGeneratedScene(scenePath) {
  try {
    const source = await fs.readFile(scenePath, 'utf8');
    const normalized = source.replace(/[ \t]+$/gm, '');
    if (normalized !== source) {
      await fs.writeFile(scenePath, normalized, 'utf8');
    }
  } catch {
    // 场景构建失败时不掩盖 Unity 自己的日志；成功构建后该文件必然存在。
  }
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', (error) => {
      console.error(`[avatar:build] 启动进程失败: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code));
  });
}

async function projectRequiredUnityPackages() {
  const avatarCatalog = await loadAvatarPackageCatalog(repoRoot);
  const sdkCatalog = JSON.parse(await fs.readFile(sdkCatalogPath, 'utf8'));
  const requiredFormats = new Set(
    avatarCatalog.packages
      .filter((avatarPackage) => avatarPackage.preferredBackend === 'unity')
      .map((avatarPackage) => avatarPackage.live2dVersion)
      .filter(Boolean),
  );
  const descriptors = new Map();

  for (const modelFormat of requiredFormats) {
    const descriptor = sdkCatalog.sdks?.find(
      (sdk) => Array.isArray(sdk.modelFormats) && sdk.modelFormats.includes(modelFormat),
    );
    if (!descriptor) {
      throw new Error(`[avatar:build] 未声明 ${modelFormat} 对应的 Unity SDK`);
    }
    descriptors.set(descriptor.id, descriptor);
  }

  for (const descriptor of descriptors.values()) {
    if (descriptor.installMode !== 'unitypackage') continue;

    const markerPath = resolveRepositoryPath(descriptor.importMarkerPath, 'importMarkerPath');
    const sourceOverride = descriptor.sourceEnv ? process.env[descriptor.sourceEnv] : undefined;
    const sourcePath = resolveRepositoryOrAbsolutePath(
      sourceOverride || descriptor.sourcePath,
      'sourcePath',
    );
    const packages = await collectFilesByExtension(sourcePath, '.unitypackage');
    if (packages.length !== 1) {
      throw new Error(
        `[avatar:build] ${descriptor.displayName} 需要且只能有一个 .unitypackage，当前发现 ${packages.length} 个`,
      );
    }

    const packageHash = await sha256File(packages[0]);
    const stampPath = resolveSdkProjectionStampPath(descriptor.id);
    if (
      await markerMatchesVersion(markerPath, descriptor.sdkVersion)
      && await projectionStampMatches(stampPath, descriptor, packageHash)
    ) {
      console.log(`[avatar:build] ${descriptor.displayName} ${descriptor.sdkVersion} 投影有效`);
      continue;
    }

    console.log(`[avatar:build] 正在投影 ${descriptor.displayName} ${descriptor.sdkVersion}`);
    await fs.rm(stampPath, { force: true });
    const result = await projectUnityPackage({
      packagePath: packages[0],
      projectPath,
      projectionScopes: descriptor.projectionScopes,
    });
    if (!(await markerMatchesVersion(markerPath, descriptor.sdkVersion))) {
      throw new Error(`[avatar:build] ${descriptor.displayName} 投影后缺少版本标记 ${markerPath}`);
    }
    await writeProjectionStamp(stampPath, descriptor, packageHash, result.count);
    console.log(`[avatar:build] ${descriptor.displayName} 已投影 ${result.count} 个资产条目`);
  }
}

function resolveSdkProjectionStampPath(descriptorId) {
  if (typeof descriptorId !== 'string' || !/^[a-z0-9-]+$/.test(descriptorId)) {
    throw new Error(`[avatar:build] SDK catalog 的 id 非法: ${descriptorId}`);
  }
  return path.join(
    projectPath,
    'Library',
    'GlimmerCradle',
    'sdk-projections',
    `${descriptorId}.json`,
  );
}

async function projectionStampMatches(stampPath, descriptor, packageHash) {
  try {
    const stamp = JSON.parse(await fs.readFile(stampPath, 'utf8'));
    return stamp.projectionVersion === sdkProjectionVersion
      && stamp.sdkId === descriptor.id
      && stamp.sdkVersion === descriptor.sdkVersion
      && JSON.stringify(stamp.projectionScopes) === JSON.stringify(descriptor.projectionScopes)
      && stamp.packageSha256 === packageHash;
  } catch {
    return false;
  }
}

async function writeProjectionStamp(stampPath, descriptor, packageHash, projectedEntryCount) {
  const temporaryPath = `${stampPath}.tmp`;
  await fs.mkdir(path.dirname(stampPath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify({
    projectionVersion: sdkProjectionVersion,
    sdkId: descriptor.id,
    sdkVersion: descriptor.sdkVersion,
    projectionScopes: descriptor.projectionScopes,
    packageSha256: packageHash,
    projectedEntryCount,
  }, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, stampPath);
}

async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function markerMatchesVersion(markerPath, sdkVersion) {
  try {
    const marker = await fs.readFile(markerPath, 'utf8');
    return !sdkVersion || marker.includes(`version: ${sdkVersion}`);
  } catch {
    return false;
  }
}

async function collectFilesByExtension(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...await collectFilesByExtension(entryPath, extension));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) {
      found.push(entryPath);
    }
  }
  return found;
}

function resolveRepositoryOrAbsolutePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`[avatar:build] SDK catalog 的 ${fieldName} 不能为空`);
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function resolveRepositoryPath(value, fieldName) {
  const resolved = resolveRepositoryOrAbsolutePath(value, fieldName);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`[avatar:build] SDK catalog 的 ${fieldName} 越过仓库边界: ${value}`);
  }
  return resolved;
}

async function resolveUnityEditor() {
  const explicit = process.env.UNITY_EDITOR || process.env.UNITY_EDITOR_PATH;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  // Unity Hub 可由用户安装到不同盘符；构建入口负责发现 Editor，调用方不应硬编码本机绝对路径。
  const hubRoots = [
    'C:\\Program Files\\Unity\\Hub\\Editor',
    'D:\\Program Files\\Unity Hub\\Editor',
  ];

  for (const hubRoot of hubRoots) {
    try {
      const versions = await fs.readdir(hubRoot);
      const candidates = versions
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((version) => path.join(hubRoot, version, 'Editor', 'Unity.exe'))
        .filter((candidate) => existsSync(candidate));
      if (candidates.length > 0) {
        return candidates[0];
      }
    } catch {
      // 继续检查下一处常见 Hub 安装目录。
    }
  }

  return null;
}
