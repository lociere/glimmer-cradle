/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

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
