/* 自动生成 — 从 ExtensionLifecycleResult.schema.json 生成，勿手动修改 */

export interface ExtensionLifecycleResult {
  request_id: string;
  extension_id: string;
  version?: string;
  operation: 'start' | 'stop';
  status: 'success' | 'error';
  message?: string;
}
