import {
  type DesktopProjectRoots,
  resolveDesktopObservabilityPath,
  resolveDesktopPackagePath,
  resolveDesktopRepoChildPath,
} from './project-paths';

export const MANAGED_AVATAR_HOST_COMMAND = 'build/components/avatar/unity-host/windows-x64/UnityAvatarHostLauncher.exe';
export const MANAGED_AVATAR_HOST_CWD = 'build/components/avatar/unity-host/windows-x64';

export interface DesktopAvatarPaths {
  readonly unityProjectPath: string;
  readonly sdkCatalogPath: string;
  readonly packageRegistryPath: string;
  readonly packageDir: string;
  readonly sdkPackageDir: string;
  readonly managedCommand: string;
  readonly managedWorkingDir: string;
  readonly managedExecutablePath: string;
  readonly processLogPath: string;
  readonly buildLogPath: string;
}

export function resolveDesktopAvatarPaths(
  roots: DesktopProjectRoots,
): DesktopAvatarPaths {
  const unityProjectPath = resolveDesktopRepoChildPath(
    roots,
    'core',
    'avatar',
    'unity-host',
  );

  return {
    unityProjectPath,
    sdkCatalogPath: resolveDesktopRepoChildPath(
      roots,
      'core',
      'avatar',
      'unity-host',
      'avatar-sdk-catalog.json',
    ),
    packageRegistryPath: resolveDesktopRepoChildPath(
      roots,
      'core',
      'avatar',
      'unity-host',
      'Assets',
      'StreamingAssets',
      'avatar-package-registry.json',
    ),
    packageDir: resolveDesktopRepoChildPath(roots, 'build', 'components', 'avatar', 'unity-host'),
    sdkPackageDir: resolveDesktopPackagePath(roots, 'avatar-sdks'),
    managedCommand: MANAGED_AVATAR_HOST_COMMAND,
    managedWorkingDir: MANAGED_AVATAR_HOST_CWD,
    managedExecutablePath: resolveDesktopRepoChildPath(
      roots,
      'build',
      'components',
      'avatar',
      'unity-host',
      'windows-x64',
      'UnityAvatarHostLauncher.exe',
    ),
    processLogPath: resolveDesktopObservabilityPath(roots, 'logs', 'application', 'avatar-host.console.log'),
    buildLogPath: resolveDesktopRepoChildPath(roots, 'build', 'logs', 'avatar', 'unity-host.log'),
  };
}
