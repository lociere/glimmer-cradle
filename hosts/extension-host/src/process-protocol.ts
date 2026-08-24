export type ExtensionHostProcessMessage =
  | ExtensionKernelRequest
  | ExtensionHostProcessRequest
  | ExtensionHostProcessResponse
  | ExtensionHostProcessReady
  | ExtensionHostProcessState;

export type ExtensionKernelMethod =
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

export type ExtensionHostProcessMethod = 'activate' | 'deactivate' | 'handler.invoke';

export type ExtensionHostProcessStage =
  | 'process_alive'
  | 'connected'
  | 'handshake'
  | 'resource_prepared'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'stopping'
  | 'stopped';

export interface ExtensionKernelRequest {
  channel: 'extension-kernel-request';
  request_id: string;
  method: ExtensionKernelMethod;
  payload?: unknown;
}

export interface ExtensionHostProcessRequest {
  channel: 'extension-host-process-request';
  request_id: string;
  method: ExtensionHostProcessMethod;
  payload?: unknown;
}

export interface ExtensionHostProcessResponse {
  channel: 'extension-host-process-response';
  request_id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ExtensionHostProcessReady {
  channel: 'extension-host-process-ready';
  runtime_id: string;
  pid: number;
}

export interface ExtensionHostProcessState {
  channel: 'extension-host-process-state';
  runtime_id: string;
  stage: ExtensionHostProcessStage;
  pid?: number;
  summary?: string;
  error?: string;
}
