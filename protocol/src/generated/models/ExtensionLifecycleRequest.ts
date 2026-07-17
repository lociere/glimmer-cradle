/* 自动生成 — 从 ExtensionLifecycleRequest.schema.json 生成，勿手动修改 */

export interface ExtensionLifecycleRequest {
  request_id: string;
  extension_id: string;
  version?: string;
  operation: 'start' | 'stop';
}
