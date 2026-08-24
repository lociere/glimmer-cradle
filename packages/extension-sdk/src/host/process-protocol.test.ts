import { describe, expect, it } from 'vitest';
import {
  ExtensionHostProcessStage as ContractExtensionHostProcessStage,
} from '@glimmer-cradle/contracts/glimmer/extension/v1/extension_host_process_pb';
import {
  EXTENSION_HOST_PROCESS_CHANNELS,
  EXTENSION_HOST_PROCESS_ERROR_CODES,
  EXTENSION_HOST_PROCESS_METHODS,
  EXTENSION_HOST_PROCESS_STAGE_TO_CONTRACT,
  EXTENSION_KERNEL_METHODS,
} from './process-protocol';

describe('extension host process protocol contract', () => {
  it('keeps process stages aligned with the canonical generated contract enum', () => {
    const generatedStages = Object.values(ContractExtensionHostProcessStage)
      .filter((value): value is number => typeof value === 'number' && value !== ContractExtensionHostProcessStage.UNSPECIFIED)
      .sort((left, right) => left - right);
    const transportStages = Object.values(EXTENSION_HOST_PROCESS_STAGE_TO_CONTRACT)
      .sort((left, right) => left - right);

    expect(transportStages).toEqual(generatedStages);
  });

  it('pins the Node IPC transport symbols in the single SDK-owned mapping', () => {
    expect(EXTENSION_HOST_PROCESS_CHANNELS).toEqual([
      'extension-kernel-request',
      'extension-host-process-request',
      'extension-host-process-response',
      'extension-host-process-ready',
      'extension-host-process-state',
    ]);
    expect(EXTENSION_HOST_PROCESS_METHODS).toEqual(['activate', 'deactivate', 'handler.invoke']);
    expect(EXTENSION_KERNEL_METHODS).toContain('registration.dispose');
    expect(EXTENSION_HOST_PROCESS_ERROR_CODES).toEqual([
      'ipc_disconnected',
      'ipc_send_failed',
      'ipc_request_timeout',
      'deactivation_timeout',
    ]);
  });
});
