/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionCommandResult {
  request_id: string;
  command_id: string;
  status: 'success' | 'error';
  result?: unknown;
  message?: string;
}
