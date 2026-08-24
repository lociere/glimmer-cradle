/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionLifecycleResult {
  request_id: string;
  extension_id: string;
  version?: string;
  activation_profile?: string;
  operation: 'start' | 'stop';
  status: 'success' | 'error';
  message?: string;
}
