/* Extension SDK 的 schema-derived manifest projection；serialized shape 由 contracts/json-schema/extension/v1 拥有。 */

export interface ExtensionRegistryCatalog {
  schema: 'glimmer-cradle.extension-registry';
  schema_version: 1;
  registry: {
    id: string;
    name: string;
    homepage: string;
  };
  extensions: ExtensionRegistryRecord[];
}
export interface ExtensionRegistryRecord {
  id: string;
  publisher: string;
  ownership: 'first_party' | 'third_party';
  listing_status: 'approved' | 'pending' | 'blocked' | 'unlisted';
  publisher_verification: 'verified' | 'unverified';
  security_status: 'normal' | 'warning' | 'blocked' | 'withdrawn';
  repository: string;
  channels: {
    stable?: string;
    beta?: string;
    nightly?: string;
  };
}
