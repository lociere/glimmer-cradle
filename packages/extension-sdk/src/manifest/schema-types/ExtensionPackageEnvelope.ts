/* Extension SDK 的 schema-derived manifest projection；serialized shape 由 contracts/json-schema/extension/v1 拥有。 */

export interface ExtensionPackageEnvelope {
  schema: 'glimmer-cradle.extension-package';
  format_version: 1;
  media_type: 'application/vnd.glimmer-cradle.extension+zip';
  payload_root: 'extension/';
  extension_manifest: 'extension/extension-manifest.yaml';
  integrity_manifest: 'META-INF/checksums.json';
  sbom: 'META-INF/sbom.spdx.json';
}
