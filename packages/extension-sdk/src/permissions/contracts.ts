import type { ExtensionPermission } from '../manifest/schema-types/ExtensionPermission';

export function hasExtensionPermission(
  permission: ExtensionPermission,
  grantedPermissions: readonly ExtensionPermission[],
): boolean {
  return grantedPermissions.includes(permission);
}
