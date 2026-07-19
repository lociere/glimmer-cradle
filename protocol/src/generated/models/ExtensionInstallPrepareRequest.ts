/* 自动生成 — 从 ExtensionInstallPrepareRequest.schema.json 生成，勿手动修改 */

export interface ExtensionInstallPrepareRequest {
  request_id: string;
  activation_profile?: string;
  source:
    | {
        kind: 'file';
        path: string;
      }
    | {
        kind: 'uploaded_package';
        upload_id: string;
      }
    | {
        kind: 'release_manifest';
        url: string;
      }
    | {
        kind: 'registry';
        catalog_url: string;
        extension_id: string;
        channel?: 'stable' | 'beta' | 'nightly';
      }
    | {
        kind: 'repository';
        repository: string;
        tag: string;
      };
}
