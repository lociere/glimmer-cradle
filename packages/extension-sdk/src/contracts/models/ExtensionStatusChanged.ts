/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionStatusChanged {
  extension_id: string;
  event: 'loaded' | 'started' | 'stopped' | 'error';
  message?: string;
}
