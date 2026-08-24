/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ExtensionInstallCommitRequest {
  request_id: string;
  transaction_id: string;
  approved_permissions: string[];
}
