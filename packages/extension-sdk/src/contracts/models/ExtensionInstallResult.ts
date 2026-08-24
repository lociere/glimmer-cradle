/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionInstallResult {
  request_id: string;
  status: 'success' | 'cancelled' | 'error';
  message?: string;
  extension_id?: string;
  version?: string;
  already_installed?: boolean;
}
