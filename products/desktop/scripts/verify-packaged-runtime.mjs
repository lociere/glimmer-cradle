#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

if (!process.argv[2]) {
  throw new Error('用法: verify-packaged-runtime.mjs <artifact-root> [resolver-path]');
}

const artifactRoot = path.resolve(process.argv[2]);
const resourcesRoot = path.join(artifactRoot, 'win-unpacked', 'resources');
const resolverPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(
    resourcesRoot,
    'app.asar.unpacked',
    'dist',
    'main',
    'packaged-paths.js',
  );
const require = createRequire(import.meta.url);
const { resolvePackagedDesktopPaths } = require(resolverPath);
if (typeof resolvePackagedDesktopPaths !== 'function') {
  throw new Error('Desktop 安装树没有导出正式 packaged path resolver');
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-packaged-runtime-'));
try {
  const resolved = await resolvePackagedDesktopPaths({ resourcesPath: resourcesRoot, userDataPath });
  const canonicalFields = {
    appRoot: { root: resourcesRoot, relative: '', kind: 'directory', display: 'resources/' },
    dataRoot: { root: userDataPath, relative: 'data', kind: 'directory', display: 'user-data/data' },
    configRoot: { root: userDataPath, relative: 'configs', kind: 'directory', display: 'user-data/configs' },
    runRoot: { root: userDataPath, relative: 'run', kind: 'directory', display: 'user-data/run' },
    nodeExecutable: { root: resourcesRoot, relative: 'runtime/node/node.exe', kind: 'file' },
    pythonExecutable: { root: resourcesRoot, relative: 'runtime/python/Scripts/python.exe', kind: 'file' },
    kernelEntry: { root: resourcesRoot, relative: 'runtime/kernel/dist/index.js', kind: 'file' },
    productManifest: { root: resourcesRoot, relative: 'products/desktop/product.json', kind: 'file' },
    extensionModuleRoot: { root: resourcesRoot, relative: 'extension-host/modules', kind: 'directory' },
    avatarHostExecutable: {
      root: resourcesRoot,
      relative: 'components/native/composition-host/bin/Release/UnityAvatarHostLauncher.exe',
      kind: 'file',
    },
    nativeLibrary: {
      root: resourcesRoot,
      relative: 'components/native/composition-host/bin/Release/platform_native.dll',
      kind: 'file',
    },
    processTreeHelper: {
      root: resourcesRoot,
      relative: 'components/native/composition-host/DesktopProcessTreeBridge.exe',
      kind: 'file',
    },
  };
  const verifiedFields = {};
  for (const [field, expected] of Object.entries(canonicalFields)) {
    const expectedPath = expected.relative
      ? path.join(expected.root, ...expected.relative.split('/'))
      : expected.root;
    const actualPath = resolved[field];
    const entry = typeof actualPath === 'string'
      ? await fs.lstat(actualPath).catch(() => null)
      : null;
    const kindMatches = expected.kind === 'file' ? entry?.isFile() : entry?.isDirectory();
    if (path.resolve(actualPath ?? '') !== path.resolve(expectedPath)
      || !entry
      || entry.isSymbolicLink()
      || !kindMatches) {
      throw new Error(`Desktop packaged resolver 字段无效: ${field}=${String(actualPath)}`);
    }
    verifiedFields[field] = {
      path: expected.display ?? expected.relative,
      kind: expected.kind,
      symlink: false,
    };
  }

  const manifest = JSON.parse(await fs.readFile(
    path.join(resourcesRoot, 'component-manifest.json'),
    'utf8',
  ));
  if (manifest.supervisor !== 'app.asar.unpacked/dist/main/packaged-supervisor.js'
    || manifest.path_resolver !== 'app.asar.unpacked/dist/main/packaged-paths.js'
    || manifest.runtime_manifest !== 'runtime/runtime-manifest.json') {
    throw new Error('Desktop component manifest 未绑定正式 supervisor/resolver/runtime');
  }
  const componentExpectations = {
    kernel: { owner: 'core/kernel', projection: 'runtime/kernel' },
    cognition: {
      owner: 'core/cognition',
      projection: 'runtime/python/Lib/site-packages/glimmer_cradle/cognition',
    },
    audio: {
      owner: 'engines/audio',
      projection: 'runtime/python/Lib/site-packages/glimmer_cradle/audio',
    },
    avatar: { owner: 'hosts/unity-avatar-host', projection: 'components/avatar/unity-host' },
    'extension-host': { owner: 'packages/extension-sdk', projection: 'extension-host/modules' },
    native: { owner: 'native', projection: 'components/native/composition-host' },
  };
  const components = new Map((manifest.components ?? []).map((component) => [component.id, component]));
  const componentOwners = {};
  for (const [componentId, expected] of Object.entries(componentExpectations)) {
    const component = components.get(componentId);
    if (component?.owner !== expected.owner
      || component?.projection !== expected.projection
      || !Array.isArray(component.files)
      || component.files.length === 0) {
      throw new Error(`Desktop component manifest owner/path 无效: ${componentId}`);
    }
    componentOwners[componentId] = {
      owner: component.owner,
      projection: component.projection,
    };
  }

  const runtimeFiles = new Map((manifest.runtime_files ?? []).map((file) => [file.path, file]));
  const kernelFiles = new Map(components.get('kernel').files.map((file) => [file.path, file]));
  const nativeFiles = new Map(components.get('native').files.map((file) => [file.path, file]));
  const avatarFiles = components.get('avatar').files;
  const extensionFiles = components.get('extension-host').files;
  const manifestBindings = [
    ['runtime/node/node.exe', runtimeFiles],
    ['runtime/python/Scripts/python.exe', runtimeFiles],
    ['runtime/kernel/dist/index.js', runtimeFiles],
    ['runtime/kernel/dist/index.js', kernelFiles],
    ['components/native/composition-host/bin/Release/UnityAvatarHostLauncher.exe', nativeFiles],
    ['components/native/composition-host/bin/Release/platform_native.dll', nativeFiles],
    ['components/native/composition-host/DesktopProcessTreeBridge.exe', nativeFiles],
  ];
  const directDigests = {};
  for (const [relativePath, records] of manifestBindings) {
    const record = records.get(relativePath);
    const absolutePath = path.join(resourcesRoot, ...relativePath.split('/'));
    const bytes = await fs.readFile(absolutePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!record || record.size !== bytes.length || record.sha256 !== digest) {
      throw new Error(`Desktop component manifest 直接 consumer 摘要无效: ${relativePath}`);
    }
    directDigests[relativePath] = digest;
  }
  if (!avatarFiles.some((file) => file.path === 'components/avatar/unity-host/UnityAvatarHost.exe')
    || avatarFiles.some((file) => file.path.endsWith('/UnityAvatarHostLauncher.exe'))
    || !extensionFiles.some((file) => file.path.startsWith('extension-host/modules/'))) {
    throw new Error('Desktop component manifest 的 Avatar/Extension 投影无效');
  }

  process.stdout.write(`${JSON.stringify({
    event: 'desktop_packaged_runtime_verified',
    fields: verifiedFields,
    component_owners: componentOwners,
    manifest_bindings: Object.keys(directDigests),
    launcher_sha256: directDigests['components/native/composition-host/bin/Release/UnityAvatarHostLauncher.exe'],
    native_library_sha256: directDigests['components/native/composition-host/bin/Release/platform_native.dll'],
    process_tree_helper_sha256: directDigests['components/native/composition-host/DesktopProcessTreeBridge.exe'],
  })}\n`);
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}
