/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionRuntimeProjectionRequest {
  request_id: string;
  extension_id?: string;
}
