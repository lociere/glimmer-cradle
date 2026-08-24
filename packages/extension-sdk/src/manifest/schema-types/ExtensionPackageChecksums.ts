/* Extension SDK 的 schema-derived manifest projection；serialized shape 由 contracts/json-schema/extension/v1 拥有。 */

export interface ExtensionPackageChecksums {
  schema: 'glimmer-cradle.extension-checksums';
  algorithm: 'sha256';
  files: {
    path: string;
    size: number;
    sha256: string;
  }[];
}
