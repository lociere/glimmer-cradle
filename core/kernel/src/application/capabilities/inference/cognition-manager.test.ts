import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKernelSideEffectPorts, kernelSideEffectPorts } from '../../../ports/kernel-side-effects.port';
import type {
  CognitionLifecycleObserver,
  CognitionProcessBootstrap,
  CognitionProcessTransportPort,
  CognitionRequestPort,
} from '../../../ports/cognition-service-port';
import { CognitionManager } from './cognition-manager';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('../../../adapters/config/config-manager', () => ({
  ConfigManager: {
    instance: {
      getConfig: () => ({
        character: {},
        system: {
          cognition_service: { request_timeout_ms: 100, registration_timeout_ms: 100 },
          memory: {}, embedding: {}, observability: {},
        },
      }),
      loadDashScopeSecretEnvironment: async () => ({}),
      loadKnowledgeBaseConfig: async () => ({}),
      freezeCoreConfig: () => undefined,
    },
  },
}));
vi.mock('../../../adapters/process/process-supervisor', () => ({
  forceTerminateManagedProcessTree: vi.fn(async () => undefined),
  stopManagedProcess: vi.fn(async () => undefined),
  waitForManagedProcessExit: vi.fn(async () => true),
}));

class FakeTransport implements CognitionProcessTransportPort {
  public isRegistered = false;
  public activeSecret: Buffer | null = null;
  public readonly invalidations: Array<{ processId?: number; reason?: Error }> = [];
  public expectedProcessId?: number;

  public prepareProcess(): CognitionProcessBootstrap {
    this.activeSecret = Buffer.alloc(32, 0x5a);
    return {
      generation: 'generation-test',
      kernelEndpoint: 'grpc://127.0.0.1:12345',
      registrationNonce: 'nonce-test',
      registrationSecret: this.activeSecret.toString('base64url'),
    };
  }

  public expectProcess(processId: number): void { this.expectedProcessId = processId; }
  public waitForRegistration(): Promise<void> { return Promise.resolve(); }
  public configureActionDeadline(): void {}
  public async invalidateProcess(processId?: number, reason?: Error): Promise<void> {
    this.invalidations.push({ processId, reason });
    this.activeSecret?.fill(0);
    this.activeSecret = null;
    this.expectedProcessId = undefined;
  }
}

class FakeChild extends EventEmitter {
  public stdout = null;
  public stderr = null;
  public stdio = [null, null, null, null];
  public constructor(public pid?: number) { super(); }
}

describe('CognitionManager process capability invalidation', () => {
  const previousRuntime = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
  const compositionPorts = kernelSideEffectPorts();

  beforeEach(() => {
    installKernelSideEffectPorts({
      ...compositionPorts,
      spawn,
      ConfigManager: {
        instance: {
          getConfig: () => ({
            character: {},
            system: { cognition_service: { request_timeout_ms: 100, registration_timeout_ms: 100 }, memory: {}, embedding: {}, observability: {} },
          }),
          loadDashScopeSecretEnvironment: async () => ({}),
          loadKnowledgeBaseConfig: async () => ({}),
          freezeCoreConfig: () => undefined,
        },
      },
    });
  });

  afterEach(async () => {
    vi.mocked(spawn).mockReset();
    const manager = CognitionManager.instance as unknown as {
      child: unknown; running: boolean; ready: boolean; starting: boolean; stopping: boolean;
    };
    manager.child = null;
    manager.running = false;
    manager.ready = false;
    manager.starting = false;
    manager.stopping = false;
    if (previousRuntime === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousRuntime;
    installKernelSideEffectPorts(compositionPorts);
  });

  it('invalidates the FD3 secret when spawn returns no PID and emits ENOENT', async () => {
    const transport = new FakeTransport();
    const observer = vi.fn();
    const manager = configureManager(transport, observer);
    const child = new FakeChild();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
      return child as never;
    });
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'Z:\\missing\\cognition.exe';

    let preparedSecret: Buffer | null = null;
    const originalPrepare = transport.prepareProcess.bind(transport);
    transport.prepareProcess = () => {
      const bootstrap = originalPrepare();
      preparedSecret = transport.activeSecret;
      return bootstrap;
    };
    await expect(manager.start()).rejects.toThrow('未返回 PID');
    await vi.waitFor(() => expect(transport.invalidations.length).toBeGreaterThanOrEqual(1));
    expect(transport.activeSecret).toBeNull();
    expect(preparedSecret!.every((value) => value === 0)).toBe(true);
    expect(transport.expectedProcessId).toBeUndefined();
    expect(observer).toHaveBeenCalledWith('failed', expect.any(String));
  });

  it('invalidates a prepared capability when stop happens before a child exists', async () => {
    const transport = new FakeTransport();
    const manager = configureManager(transport, vi.fn());
    transport.prepareProcess();
    const preparedSecret = transport.activeSecret!;
    await manager.stop();
    expect(transport.activeSecret).toBeNull();
    expect(preparedSecret.every((value) => value === 0)).toBe(true);
    expect(transport.invalidations.at(-1)).toMatchObject({ processId: undefined });
  });

  it('invalidates the supervised capability on a child error event', async () => {
    const transport = new FakeTransport();
    const manager = configureManager(transport, vi.fn());
    transport.prepareProcess();
    const preparedSecret = transport.activeSecret!;
    transport.expectProcess(4040);
    const child = new FakeChild(4040);
    const internals = manager as unknown as {
      child: FakeChild | null;
      running: boolean;
      ready: boolean;
      attachProcessObservers(child: FakeChild): void;
    };
    internals.child = child;
    internals.running = true;
    internals.ready = true;
    internals.attachProcessObservers(child);

    child.emit('error', new Error('child pipe failed'));
    await vi.waitFor(() => expect(transport.invalidations).toHaveLength(1));
    expect(transport.invalidations[0].processId).toBe(4040);
    expect(transport.activeSecret).toBeNull();
    expect(preparedSecret.every((value) => value === 0)).toBe(true);
    expect(manager.isReady).toBe(false);
  });
});

function configureManager(
  transport: FakeTransport,
  observer: CognitionLifecycleObserver,
): CognitionManager {
  return CognitionManager.configure(
    transport,
    {
      shutdown: async () => undefined,
    } as unknown as CognitionRequestPort,
    observer,
  );
}
