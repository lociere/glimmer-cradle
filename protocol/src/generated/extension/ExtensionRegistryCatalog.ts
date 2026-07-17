/* 自动生成 — 从 ExtensionRegistryCatalog.schema.json 生成，勿手动修改 */

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
