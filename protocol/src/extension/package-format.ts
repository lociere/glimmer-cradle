export const EXTENSION_PACKAGE_MEDIA_TYPE = 'application/vnd.glimmer-cradle.extension+zip' as const;
export const EXTENSION_PACKAGE_SCHEMA = 'glimmer-cradle.extension-package' as const;
export const EXTENSION_RELEASE_SCHEMA = 'glimmer-cradle.extension-release' as const;
export const EXTENSION_REGISTRY_SCHEMA = 'glimmer-cradle.extension-registry' as const;
export const EXTENSION_PACKAGE_FORMAT_VERSION = 1 as const;

export function isSafeExtensionPackagePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\') || value.includes('\0')) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}
