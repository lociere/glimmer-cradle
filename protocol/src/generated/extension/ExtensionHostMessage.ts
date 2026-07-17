/* 自动生成 — 从 ExtensionHostMessage.schema.json 生成，勿手动修改 */

/**
 * Kernel Extension Host 与隔离 Worker 之间的 RPC 消息。
 */
export type ExtensionHostMessage =
  | ExtensionHostRequest
  | ExtensionWorkerRequest
  | ExtensionRpcResponse
  | ExtensionWorkerReady;
export type ExtensionHostMethod =
  | 'log'
  | 'storage.get'
  | 'storage.set'
  | 'storage.delete'
  | 'evidence.submit'
  | 'perception.inject'
  | 'attention.acquire'
  | 'attention.focused'
  | 'attention.policies'
  | 'events.subscribe'
  | 'events.emit'
  | 'agents.register'
  | 'commands.register'
  | 'commands.execute'
  | 'commands.list'
  | 'runtime.capabilities'
  | 'runtime.diagnostics'
  | 'registration.dispose';
export type ExtensionWorkerMethod = 'activate' | 'deactivate' | 'handler.invoke';

export interface ExtensionHostRequest {
  channel: 'extension-host-request';
  request_id: string;
  method: ExtensionHostMethod;
  payload?: unknown;
}
export interface ExtensionWorkerRequest {
  channel: 'extension-worker-request';
  request_id: string;
  method: ExtensionWorkerMethod;
  payload?: unknown;
}
export interface ExtensionRpcResponse {
  channel: 'extension-rpc-response';
  request_id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
export interface ExtensionWorkerReady {
  channel: 'extension-worker-ready';
  pid: number;
}
