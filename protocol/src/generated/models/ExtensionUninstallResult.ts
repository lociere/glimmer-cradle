/* 自动生成 — 从 ExtensionUninstallResult.schema.json 生成，勿手动修改 */

export interface ExtensionUninstallResult {
  request_id: string;
  extension_id: string;
  version: string;
  status: 'success' | 'error';
  message?: string;
}
