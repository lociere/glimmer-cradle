/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionCommandRequest {
  request_id: string;
  command_id: string;
  args: unknown[];
}
