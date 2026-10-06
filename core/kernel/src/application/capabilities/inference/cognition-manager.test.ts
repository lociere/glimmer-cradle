import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CognitionLifecycleObserver,
  CognitionProcessBootstrap,
  CognitionProcessTransportPort,
  CognitionRequestPort,
} from '../../../ports/cognition-service-port';
import { CognitionManager } from '../../../adapters/cognition/cognition-process-adapter';

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

  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  afterEach(async () => {
    vi.mocked(spawn).mockReset();
    if (previousRuntime === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousRuntime;
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

  it.each(['legacy', 'external'] as const)('passes %s owner and waits for initial projection without prematurely opening ingress', async (owner) => {
    const transport = new FakeTransport();
    transport.isRegistered = true;
    const observer = vi.fn();
    let releaseReady!: () => void;
    const readyBarrier = new Promise<void>((resolve) => { releaseReady = resolve; });
    const readiness = vi.fn()
      .mockResolvedValueOnce({ state: 'starting', phase: 'domain_starting', generation: 'generation-test' })
      .mockImplementation(async () => {
        await readyBarrier;
        return { state: 'ready', phase: 'ready', generation: 'generation-test' };
      });
    const manager = configureManager(transport, observer, {
      initializeKnowledge: async () => undefined, readiness,
    }, owner);
    const child = Object.assign(new FakeChild(4040), {
      stdio: [null, null, null, { write: () => true, end: () => undefined }],
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'test-runtime';
    const startup = manager.start();
    await vi.waitFor(() => expect(readiness).toHaveBeenCalledTimes(2));
    expect(manager.isReady).toBe(false);
    expect(observer.mock.calls.some(([state]) => state === 'ready')).toBe(false);
    releaseReady();
    await startup;
    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(['-m', 'glimmer_cradle.cognition_worker', '--memory-jobs-owner', owner]);
    expect(readiness).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls.filter(([state]) => state === 'ready')).toHaveLength(1);
    expect(manager.isReady).toBe(true);
    await manager.stop();
  });

  it.each(['wrong-generation', 'stopping', 'deadline'])('keeps ingress closed for %s readiness', async (failure) => {
    const transport = new FakeTransport();
    transport.isRegistered = true;
    const observer = vi.fn();
    const readiness = vi.fn(async () => ({
      state: failure === 'stopping' ? 'stopping' : failure === 'deadline' ? 'starting' : 'ready',
      phase: 'domain_starting',
      generation: failure === 'wrong-generation' ? 'old-generation' : 'generation-test',
    }));
    const manager = configureManager(transport, observer, {
      initializeKnowledge: async () => undefined, readiness,
    });
    const child = Object.assign(new FakeChild(4040), {
      stdio: [null, null, null, { write: () => true, end: () => undefined }],
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'test-runtime';
    await expect(manager.start()).rejects.toThrow(/ready|readiness/);
    expect(manager.isReady).toBe(false);
    expect(observer.mock.calls.some(([state]) => state === 'ready')).toBe(false);
    expect(observer).toHaveBeenCalledWith('failed', expect.any(String));
    expect(transport.activeSecret).toBeNull();
  });
});

function configureManager(
  transport: FakeTransport,
  observer: CognitionLifecycleObserver,
  client: Partial<CognitionRequestPort> = {},
  owner: 'legacy' | 'external' = 'legacy',
): CognitionManager {
  return new CognitionManager(
    transport,
    {
      shutdown: async () => undefined,
      ...client,
    } as unknown as CognitionRequestPort,
    observer,
    owner,
  );
}
