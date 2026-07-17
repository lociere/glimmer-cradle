/* 自动生成 — 从 ExtensionPackageEnvelope.schema.json 生成，勿手动修改 */

export interface ExtensionPackageEnvelope {
  schema: 'glimmer-cradle.extension-package';
  format_version: 1;
  media_type: 'application/vnd.glimmer-cradle.extension+zip';
  payload_root: 'extension/';
  extension_manifest: 'extension/extension-manifest.yaml';
  integrity_manifest: 'META-INF/checksums.json';
  sbom: 'META-INF/sbom.spdx.json';
}
