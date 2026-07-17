/* 自动生成 — 从 ExtensionCommandResult.schema.json 生成，勿手动修改 */

export interface ExtensionCommandResult {
  request_id: string;
  command_id: string;
  status: 'success' | 'error';
  result?: unknown;
  message?: string;
}
