export {
  EXTENSION_PACKAGE_FORMAT_VERSION,
  EXTENSION_PACKAGE_MEDIA_TYPE,
  EXTENSION_PACKAGE_SCHEMA,
  EXTENSION_REGISTRY_SCHEMA,
  EXTENSION_RELEASE_SCHEMA,
  isSafeExtensionPackagePath,
  validateExtensionPackageChecksums,
  validateExtensionPackageEnvelope,
  validateExtensionRegistryCatalog,
  validateExtensionReleaseManifest,
} from '@glimmer-cradle/protocol';
export type {
  ExtensionPackageChecksums,
  ExtensionPackageEnvelope,
  ExtensionRegistryCatalog,
  ExtensionRegistryRecord,
  ExtensionReleaseArtifact,
  ExtensionReleaseManifest,
} from '@glimmer-cradle/protocol';
export type ExtensionReleaseChannel = import('@glimmer-cradle/protocol').ExtensionReleaseManifest['channel'];
