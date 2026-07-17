import type { ExtensionPermission } from '../generated/extension/ExtensionPermission';

export function hasExtensionPermission(
  permission: ExtensionPermission,
  grantedPermissions: readonly ExtensionPermission[],
): boolean {
  return grantedPermissions.includes(permission);
}
