/* 自动生成 — 从 ExtensionInstallResult.schema.json 生成，勿手动修改 */

export interface ExtensionInstallResult {
  request_id: string;
  status: 'success' | 'cancelled' | 'error';
  message?: string;
  extension_id?: string;
  version?: string;
  already_installed?: boolean;
}
