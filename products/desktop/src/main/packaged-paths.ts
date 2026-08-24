import { cp, lstat, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export interface PackagedDesktopPaths {
  readonly appRoot: string;
  readonly dataRoot: string;
  readonly configRoot: string;
  readonly runRoot: string;
  readonly nodeExecutable: string;
  readonly pythonExecutable: string;
  readonly kernelEntry: string;
  readonly productManifest: string;
  readonly extensionModuleRoot: string;
  readonly avatarHostExecutable: string;
  readonly nativeLibrary: string;
  readonly processTreeHelper: string;
}

export async function resolvePackagedDesktopPaths(options: {
  readonly resourcesPath: string;
  readonly userDataPath: string;
}): Promise<PackagedDesktopPaths> {
  const appRoot = path.resolve(options.resourcesPath);
  const userRoot = path.resolve(options.userDataPath);
  const paths: PackagedDesktopPaths = {
    appRoot,
    dataRoot: path.join(userRoot, 'data'),
    configRoot: path.join(userRoot, 'configs'),
    runRoot: path.join(userRoot, 'run'),
    nodeExecutable: trustedResource(appRoot, 'runtime/node/node.exe'),
    pythonExecutable: trustedResource(appRoot, 'runtime/python/Scripts/python.exe'),
    kernelEntry: trustedResource(appRoot, 'runtime/kernel/dist/index.js'),
    productManifest: trustedResource(appRoot, 'products/desktop/product.json'),
    extensionModuleRoot: trustedResource(appRoot, 'extension-host/modules'),
    avatarHostExecutable: trustedResource(
      appRoot,
      'components/native/composition-host/bin/Release/UnityAvatarHostLauncher.exe',
    ),
    nativeLibrary: trustedResource(
      appRoot,
      'components/native/composition-host/bin/Release/platform_native.dll',
    ),
    processTreeHelper: trustedResource(
      appRoot,
      'components/native/composition-host/DesktopProcessTreeBridge.exe',
    ),
  };
  for (const required of [
    paths.nodeExecutable,
    paths.pythonExecutable,
    paths.kernelEntry,
    paths.productManifest,
    paths.extensionModuleRoot,
    paths.avatarHostExecutable,
    paths.nativeLibrary,
    paths.processTreeHelper,
  ]) {
    const entry = await lstat(required).catch(() => null);
    if (!entry || entry.isSymbolicLink()) {
      throw new Error(`Desktop packaged runtime 缺失或不可信: ${required}`);
    }
  }
  await mkdir(paths.dataRoot, { recursive: true });
  await mkdir(paths.runRoot, { recursive: true });
  await initializeConfig(appRoot, paths.configRoot);
  return paths;
}

function trustedResource(resourcesRoot: string, relativePath: string): string {
  const target = path.resolve(resourcesRoot, ...relativePath.split('/'));
  const relative = path.relative(resourcesRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Desktop packaged path 越界: ${relativePath}`);
  }
  return target;
}

async function initializeConfig(appRoot: string, configRoot: string): Promise<void> {
  const existing = await lstat(configRoot).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`Desktop config root 不可信: ${configRoot}`);
    }
    return;
  }
  const defaults = trustedResource(appRoot, 'configs/defaults');
  const defaultsStat = await lstat(defaults).catch(() => null);
  if (!defaultsStat?.isDirectory() || defaultsStat.isSymbolicLink()) {
    throw new Error('Desktop packaged config defaults 缺失');
  }
  const temporary = `${configRoot}.initialize-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  await cp(defaults, temporary, { recursive: true, dereference: false });
  try {
    await rename(temporary, configRoot);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
