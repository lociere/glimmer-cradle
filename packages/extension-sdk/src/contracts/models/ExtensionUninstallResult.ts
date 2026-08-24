/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionUninstallResult {
  request_id: string;
  extension_id: string;
  version: string;
  status: 'success' | 'error';
  message?: string;
}
