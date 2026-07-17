import path from 'node:path';

export const MANAGED_AVATAR_HOST_COMMAND = 'build/components/avatar/unity-host/windows-x64/UnityAvatarHostLauncher.exe';
export const MANAGED_AVATAR_HOST_CWD = 'build/components/avatar/unity-host/windows-x64';

export function resolveAvatarUnityProjectPath(repoRoot) {
  return path.join(repoRoot, 'core', 'avatar', 'unity-host');
}

export function resolveAvatarSdkCatalogPath(repoRoot) {
  return path.join(resolveAvatarUnityProjectPath(repoRoot), 'avatar-sdk-catalog.json');
}

export function resolveAvatarStreamingAssetsPath(repoRoot, ...segments) {
  return path.join(
    resolveAvatarUnityProjectPath(repoRoot),
    'Assets',
    'StreamingAssets',
    ...segments,
  );
}

export function resolveAvatarPackageRegistryPath(repoRoot) {
  return resolveAvatarStreamingAssetsPath(repoRoot, 'avatar-package-registry.json');
}

export function resolveManagedUnityAvatarHostPackageDir(repoRoot) {
  return path.join(repoRoot, 'build', 'components', 'avatar', 'unity-host');
}

export function resolveManagedUnityAvatarHostWorkingDir(repoRoot) {
  return path.join(resolveManagedUnityAvatarHostPackageDir(repoRoot), 'windows-x64');
}

export function resolveManagedAvatarHostExecutablePath(repoRoot) {
  return path.join(resolveManagedUnityAvatarHostWorkingDir(repoRoot), 'UnityAvatarHost.exe');
}

export function resolveManagedAvatarHostLauncherPath(repoRoot) {
  return path.join(resolveManagedUnityAvatarHostWorkingDir(repoRoot), 'UnityAvatarHostLauncher.exe');
}

export function resolveAvatarSdkPackageDir(repoRoot) {
  return path.join(repoRoot, 'data', 'packages', 'avatar-sdks');
}

export function resolveAvatarProcessLogPath(repoRoot) {
  return path.join(repoRoot, 'data', 'observability', 'logs', 'application', 'avatar-host.console.log');
}

export function resolveAvatarBuildLogPath(repoRoot) {
  return path.join(repoRoot, 'build', 'logs', 'avatar', 'unity-host.log');
}
