import {
  ExtensionHostProcessStage as ContractExtensionHostProcessStage,
} from '@glimmer-cradle/contracts/glimmer/extension/v1/extension_host_process_pb';

/**
 * Public Node IPC compatibility shim between Kernel supervision and the isolated
 * Extension Host process.
 *
 * `contracts/proto/glimmer/extension/v1/extension_host_process.proto` owns the
 * versioned service/stage vocabulary. This file owns only the current Slice 6
 * Node IPC channel/method names until the Host transport moves fully behind the
 * Contract Spine service.
 */
export const EXTENSION_HOST_PROCESS_CHANNELS = [
  'extension-kernel-request',
  'extension-host-process-request',
  'extension-host-process-response',
  'extension-host-process-ready',
  'extension-host-process-state',
] as const;

export const EXTENSION_KERNEL_METHODS = [
  'log',
  'storage.get',
  'storage.set',
  'storage.delete',
  'evidence.submit',
  'perception.inject',
  'attention.acquire',
  'attention.focused',
  'attention.policies',
  'events.subscribe',
  'events.emit',
  'agents.register',
  'commands.register',
  'commands.execute',
  'commands.list',
  'runtime.capabilities',
  'runtime.diagnostics',
  'registration.dispose',
] as const;

export const EXTENSION_HOST_PROCESS_METHODS = [
  'activate',
  'deactivate',
  'handler.invoke',
] as const;

export const EXTENSION_HOST_PROCESS_STAGE_TO_CONTRACT = {
  process_alive: ContractExtensionHostProcessStage.PROCESS_ALIVE,
  connected: ContractExtensionHostProcessStage.CONNECTED,
  handshake: ContractExtensionHostProcessStage.HANDSHAKE,
  resource_prepared: ContractExtensionHostProcessStage.RESOURCE_PREPARED,
  ready: ContractExtensionHostProcessStage.READY,
  degraded: ContractExtensionHostProcessStage.DEGRADED,
  failed: ContractExtensionHostProcessStage.FAILED,
  stopping: ContractExtensionHostProcessStage.STOPPING,
  stopped: ContractExtensionHostProcessStage.STOPPED,
} as const satisfies Record<string, ContractExtensionHostProcessStage>;

export const EXTENSION_HOST_PROCESS_STAGES = Object.keys(
  EXTENSION_HOST_PROCESS_STAGE_TO_CONTRACT,
) as Array<keyof typeof EXTENSION_HOST_PROCESS_STAGE_TO_CONTRACT>;

export const EXTENSION_HOST_PROCESS_ERROR_CODES = [
  'ipc_disconnected',
  'ipc_send_failed',
  'ipc_request_timeout',
  'deactivation_timeout',
] as const;

export type ExtensionHostProcessChannel = typeof EXTENSION_HOST_PROCESS_CHANNELS[number];
export type ExtensionKernelMethod = typeof EXTENSION_KERNEL_METHODS[number];
export type ExtensionHostProcessMethod = typeof EXTENSION_HOST_PROCESS_METHODS[number];
export type ExtensionHostProcessStage = typeof EXTENSION_HOST_PROCESS_STAGES[number];
export type ExtensionHostProcessErrorCode = typeof EXTENSION_HOST_PROCESS_ERROR_CODES[number];

export type ExtensionHostProcessMessage =
  | ExtensionKernelRequest
  | ExtensionHostProcessRequest
  | ExtensionHostProcessResponse
  | ExtensionHostProcessReady
  | ExtensionHostProcessState;

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

export type ExtensionHostMethod = ExtensionKernelMethod;
export type ExtensionHostRequest = ExtensionKernelRequest;
export type ExtensionRpcResponse = ExtensionHostProcessResponse;
