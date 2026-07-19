/* 自动生成 — 从 ExtensionInstallPreview.schema.json 生成，勿手动修改 */

export interface ExtensionInstallPreview {
  request_id: string;
  status: 'ready' | 'error';
  message?: string;
  transaction_id?: string;
  activation_profile?: {
    id: string;
    title: string;
    description?: string;
    default?: boolean;
  };
  available_profiles?: {
    id: string;
    title: string;
    description?: string;
    default?: boolean;
    supported: boolean;
    disabled_reason?: string;
  }[];
  effective_permissions?: string[];
  effective_resources?: string[];
  effective_capabilities?: string[];
  effective_settings?: string[];
  extension?: {
    id: string;
    name: string;
    version: string;
    publisher: string;
    description?: string;
    permissions: string[];
    platforms: string[];
  };
  artifact?: {
    sha256: string;
    size: number;
    platform: string;
  };
  trust?: {
    source_kind: 'file' | 'release_manifest' | 'registry' | 'repository';
    listing_reviewed: boolean;
    publisher_verified: boolean;
    artifact_signed: boolean;
    build_attested: boolean;
    registry_id?: string;
    repository?: string;
  };
}
