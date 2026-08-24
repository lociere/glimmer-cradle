/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionLifecycleRequest {
  request_id: string;
  extension_id: string;
  version?: string;
  activation_profile?: string;
  operation: 'start' | 'stop';
}
