/* 自动生成 — 从 ExtensionStatusChanged.schema.json 生成，勿手动修改 */

export interface ExtensionStatusChanged {
  extension_id: string;
  event: 'loaded' | 'started' | 'stopped' | 'error';
  message?: string;
}
