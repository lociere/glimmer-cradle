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
import { ConfigManager } from '../../../adapters/config/config-manager';
import fs from 'fs-extra';

const loggerMethods = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../../adapters/observability/logger', () => ({ getLogger: () => loggerMethods }));

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../../adapters/config/config-manager', () => ({
  ConfigManager: {
    instance: {
      getConfig: () => ({
        character: {},
        system: {
          cognition_service: { request_timeout_ms: 100, registration_timeout_ms: 100 },
          lifecycle: { start_timeout_ms: 30000, stop_timeout_ms: 30000 },
          memory: {}, embedding: {}, observability: {},
        },
      }),
      loadDashScopeSecretEnvironment: async () => ({}),
      loadKnowledgeBaseConfig: async () => ({}),
      freezeCoreConfig: () => undefined,
    },
  },
}));
const processMethods = vi.hoisted(() => ({
  forceTerminateManagedProcessTree: vi.fn(), stopManagedProcess: vi.fn(), waitForManagedProcessExit: vi.fn(),
  readManagedProcessOutput: vi.fn(),
}));
vi.mock('@glimmer-cradle/platform', async () => ({
  ...await vi.importActual<object>('@glimmer-cradle/platform'),
  ManagedProcessSupervisor: class {
    spawnManagedProcess(command: string, args: string[], options: object, _bridge: unknown, port: typeof spawn) {
      if (args[0] === '-c') { const probe = new FakeChild(2121); probe.exitCode = 0; probe.probeCommand = command; return probe; }
      return port(command, args, options);
    }
    readManagedProcessOutput = processMethods.readManagedProcessOutput;
    async waitForManagedProcessReady(child: FakeChild) { if (!child.pid) throw new Error('受管子进程未取得 PID'); return child.pid; }
    managedProcessPid(child: FakeChild) { return child.pid; }
    isManagedProcessRootRunning(child: FakeChild) { return child.exitCode === null && child.signalCode === null; }
    onManagedProcessRootExit(child: FakeChild, observer: (...args: unknown[]) => void) { child.once(child.nativeReleased === undefined ? 'exit' : 'root-exit', observer); }
    onManagedProcessExit(child: FakeChild, observer: (...args: unknown[]) => void) { child.once('exit', observer); }
    observeManagedProcess() {}
    forceTerminateManagedProcessTree = processMethods.forceTerminateManagedProcessTree;
    stopManagedProcess = processMethods.stopManagedProcess;
    waitForManagedProcessExit = processMethods.waitForManagedProcessExit;
    isProcessReleased(child: FakeChild): boolean { return child.nativeReleased ?? (child.exitCode != null || child.signalCode != null); }
  },
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
    this.isRegistered = false;
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
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public nativeReleased?: boolean;
  public probeCommand?: string;
  public constructor(public pid?: number) { super(); }
}

describe('CognitionManager process capability invalidation', () => {
  const previousRuntime = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;

  beforeEach(() => {
    vi.mocked(spawn).mockReset();
    for (const method of Object.values(processMethods)) method.mockReset();
    for (const method of Object.values(loggerMethods)) method.mockReset();
    const exit = async (child?: FakeChild) => { if (child) child.exitCode = 0; };
    processMethods.stopManagedProcess.mockImplementation(exit);
    processMethods.forceTerminateManagedProcessTree.mockImplementation(exit);
    processMethods.waitForManagedProcessExit.mockImplementation(async (child: FakeChild) => { child.exitCode = 0; return true; });
    processMethods.readManagedProcessOutput.mockImplementation(async (child: FakeChild) => {
      child.exitCode = 0;
      return { stdout: JSON.stringify({ base: child.probeCommand, executable: child.probeCommand }), stderr: '', code: 0 };
    });
  });

  afterEach(async () => {
    vi.mocked(spawn).mockReset();
    if (previousRuntime === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousRuntime;
  });

  it('seals parallel startup before the first preparation await and suppresses stale failure after explicit stop', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const secrets = vi.spyOn(ConfigManager.instance, 'loadDashScopeSecretEnvironment').mockImplementationOnce(async () => { await gate; return {}; });
    const observer = vi.fn(), transport = new FakeTransport();
    const manager = configureManager(transport, observer, {
      initializeKnowledge: async () => undefined,
      readiness: async () => ({ state: 'ready', phase: 'ready', generation: 'generation-test' }),
    });
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'test-runtime';
    const startup = manager.start();
    const outcome = expect(startup).rejects.toThrow('启动世代已关闭');
    try {
      await expect(manager.start()).rejects.toThrow('上代进程尚未释放');
      expect(secrets).toHaveBeenCalledOnce(); expect(spawn).not.toHaveBeenCalled();
      await manager.stop();
      await expect(manager.start()).rejects.toThrow('上代进程尚未释放');
      release(); await outcome;
      expect(spawn).not.toHaveBeenCalled(); expect(observer.mock.calls.some(([state]) => state === 'failed')).toBe(false);
      expect((manager as unknown as { starting: boolean }).starting).toBe(false);
      const child = Object.assign(new FakeChild(4040), { stdio: [null, null, null, { write: () => true, end() {} }] });
      vi.mocked(spawn).mockReturnValue(child as never); transport.isRegistered = true;
      await manager.start(); expect(manager.isReady).toBe(true);
      expect(observer.mock.calls.some(([state]) => state === 'ready')).toBe(true);
    } finally { release(); await startup.catch(() => undefined); await manager.stop(); secrets.mockRestore(); }
  });

  it.each(['registration', 'configuration', 'initialization', 'readiness', 'registration-error'] as const)('explicit stop during %s rejects late startup without republishing failure or repeating process cleanup', async stage => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const transport = new FakeTransport(); transport.isRegistered = true;
    const observer = vi.fn();
    const registration = vi.spyOn(transport, 'waitForRegistration').mockImplementation(async () => {
      if (stage.startsWith('registration')) await gate;
      if (stage === 'registration-error') throw new Error('late registration failure');
    });
    const configuration = vi.spyOn(ConfigManager.instance, 'loadKnowledgeBaseConfig').mockImplementation(async () => {
      if (stage === 'configuration') await gate;
      return {} as never;
    });
    const initializeKnowledge = vi.fn(async () => { if (stage === 'initialization') await gate; });
    const readiness = vi.fn(async () => { if (stage === 'readiness') await gate; return { state: 'ready', phase: 'ready', generation: 'generation-test' } as const; });
    const manager = configureManager(transport, observer, { initializeKnowledge, readiness });
    const child = Object.assign(new FakeChild(4040), { stdio: [null, null, null, { write: () => true, end() {} }] });
    vi.mocked(spawn).mockReturnValue(child as never);
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'test-runtime';
    const startup = manager.start();
    void startup.catch(() => undefined);
    try {
      const entered = stage.startsWith('registration') ? registration : stage === 'configuration' ? configuration : stage === 'initialization' ? initializeKnowledge : readiness;
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      await manager.stop();
      expect(observer.mock.calls.at(-1)?.[0]).toBe('stopped');
      release(); await expect(startup).rejects.toThrow(stage === 'registration-error' ? 'late registration failure' : /已关闭|已失效/);
      expect(observer.mock.calls.at(-1)?.[0]).toBe('stopped');
      expect(observer.mock.calls.some(([state]) => state === 'failed' || state === 'ready')).toBe(false);
      if (stage.startsWith('registration') || stage === 'configuration') expect(initializeKnowledge).not.toHaveBeenCalled();
      expect(processMethods.waitForManagedProcessExit).toHaveBeenCalledOnce();
      expect(processMethods.forceTerminateManagedProcessTree).not.toHaveBeenCalled();
      expect((manager as unknown as { child: unknown }).child).toBeNull(); expect(manager.isReady).toBe(false);
    } finally { release(); await startup.catch(() => undefined); await manager.stop(); registration.mockRestore(); configuration.mockRestore(); }
  });

  it('development uv preparation belongs to the same managed startup owner and cannot launch Worker after stop', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pathExists = vi.spyOn(fs, 'pathExists').mockResolvedValue(true as never);
    const observer = vi.fn(), manager = configureManager(new FakeTransport(), observer);
    const setup = new FakeChild(4142);
    vi.mocked(spawn).mockReturnValue(setup as never);
    processMethods.readManagedProcessOutput.mockImplementationOnce(async () => { await gate; return { stdout: '', stderr: '', code: 0 }; });
    delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    const startup = manager.start();
    const outcome = expect(startup).rejects.toThrow('启动世代已关闭');
    try {
      await vi.waitFor(() => expect(processMethods.readManagedProcessOutput).toHaveBeenCalledOnce());
      expect((manager as unknown as { startupProcess: unknown }).startupProcess).toBe(setup);
      expect(vi.mocked(spawn).mock.calls[0][0]).toBe(process.platform === 'win32' ? 'uv.exe' : 'uv');
      expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(expect.arrayContaining(['sync', '--frozen', '--inexact']));
      await manager.stop();
      expect(processMethods.forceTerminateManagedProcessTree.mock.calls[0][0]).toBe(setup);
      release(); await outcome;
      expect(spawn).toHaveBeenCalledOnce(); expect(observer.mock.calls.some(([state]) => state === 'failed')).toBe(false);
      expect((manager as unknown as { startupProcess: unknown }).startupProcess).toBeNull();
    } finally { release(); await startup.catch(() => undefined); await manager.stop(); pathExists.mockRestore(); }
  });

  it('an explicit stop during delayed restart cannot launch a new generation afterward', async () => {
    vi.useFakeTimers();
    const manager = configureManager(new FakeTransport(), vi.fn());
    const start = vi.spyOn(manager, 'start').mockResolvedValue();
    const restarting = manager.restart(); void restarting.catch(() => undefined);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      await manager.stop();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(restarting).rejects.toThrow('restart 世代已关闭');
      expect(start).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
    } finally { start.mockRestore(); vi.useRealTimers(); await manager.stop(); }
  });

  it.each([false, true])('late recovery invalidation failure respects explicit cancellation=%s without hiding a current failure', async cancelled => {
    let reject!: (error: Error) => void;
    const invalidation = new Promise<void>((_resolve, no) => { reject = no; });
    const observer = vi.fn(), manager = configureManager(new FakeTransport(), observer);
    const internals = manager as unknown as { recoveryGeneration: number; recoverAfterUnexpectedExit(pending: Promise<void>, generation: number): Promise<void> };
    internals.recoveryGeneration = 7;
    const recovery = internals.recoverAfterUnexpectedExit(invalidation, 7);
    if (cancelled) await manager.stop();
    reject(new Error('late invalidation failure')); await recovery;
    expect(observer.mock.calls.some(([state]) => state === 'failed')).toBe(!cancelled);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('diagnostic failure cannot skip cleanup of a genuinely failed startup or discard either error', async () => {
    const transport = new FakeTransport(); transport.isRegistered = true;
    const observer = vi.fn();
    const manager = configureManager(transport, observer, { initializeKnowledge: async () => undefined,
      readiness: async () => ({ state: 'ready', phase: 'ready', generation: 'wrong-generation' }) });
    const child = Object.assign(new FakeChild(4143), { stdio: [null, null, null, { write: () => true, end() {} }] });
    vi.mocked(spawn).mockReturnValue(child as never);
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'test-runtime';
    loggerMethods.error.mockImplementation(() => { throw new Error('diagnostic observer failed'); });
    await expect(manager.start()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: expect.stringContaining('readiness') }), expect.objectContaining({ message: 'diagnostic observer failed' })] });
    expect(processMethods.waitForManagedProcessExit).toHaveBeenCalledOnce();
    expect((manager as unknown as { child: unknown }).child).toBeNull(); expect(manager.isReady).toBe(false);
    expect(transport.activeSecret).toBeNull(); expect(observer).toHaveBeenCalledWith('failed', expect.any(String));
  });

  it('shutdown diagnostic and invalidation failures cannot skip actual process release or hide each other', async () => {
    const transport = new FakeTransport(); transport.isRegistered = true;
    const observer = vi.fn(), manager = configureManager(transport, observer, { shutdown: async () => { throw new Error('protocol unavailable'); } });
    const child = new FakeChild(4144);
    const internals = manager as unknown as { child: FakeChild | null; running: boolean; ready: boolean };
    internals.child = child; internals.running = internals.ready = true;
    const invalidate = vi.spyOn(transport, 'invalidateProcess').mockRejectedValueOnce(new Error('invalidate failed'));
    loggerMethods.warn.mockImplementation(() => { throw new Error('warning observer failed'); });
    await expect(manager.stop()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'warning observer failed' }), expect.objectContaining({ message: 'invalidate failed' })] });
    expect(processMethods.stopManagedProcess).toHaveBeenCalledOnce();
    expect(internals.child).toBeNull(); expect(manager.isReady).toBe(false);
    expect(observer).toHaveBeenCalledWith('stopped', expect.any(String));
    invalidate.mockRestore();
  });

  it('retains a live process after failed stop, seals ingress and retries the same owner', async () => {
    const transport = new FakeTransport();
    const manager = configureManager(transport, vi.fn());
    const child = new FakeChild(4141);
    const internals = manager as unknown as { child: FakeChild | null; running: boolean; ready: boolean };
    internals.child = child;
    internals.running = internals.ready = true;
    transport.prepareProcess();
    processMethods.stopManagedProcess.mockRejectedValueOnce(new Error('kill denied'));
    const first = manager.stop();
    expect(manager.stop()).toBe(first);
    await expect(first).rejects.toThrow('kill denied');
    expect(internals.child).toBe(child);
    expect(manager.isReady).toBe(false);
    expect(transport.activeSecret).toBeNull();
    await expect(manager.start()).rejects.toThrow('上代进程尚未释放');
    expect(spawn).not.toHaveBeenCalled();
    await manager.stop();
    expect(internals.child).toBeNull();
    expect(processMethods.stopManagedProcess).toHaveBeenCalledTimes(2);
  });

  it('a startup observer cannot mask Native release failure, and the same startup Job remains retryable', async () => {
    const observer = vi.fn((): void => { throw new Error('startup observer failed'); });
    const manager = configureManager(new FakeTransport(), observer);
    const child = new FakeChild(4241); child.nativeReleased = false;
    const internals = manager as unknown as { startupProcess: FakeChild | null };
    internals.startupProcess = child;
    processMethods.forceTerminateManagedProcessTree.mockRejectedValueOnce(new Error('Native release denied'));
    await expect(manager.stop()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'Native release denied' }), expect.objectContaining({ message: 'startup observer failed' })] });
    expect(internals.startupProcess).toBe(child);
    await expect(manager.start()).rejects.toThrow('上代进程尚未释放');
    observer.mockImplementation(() => undefined);
    processMethods.forceTerminateManagedProcessTree.mockImplementation(async (owned: FakeChild) => { owned.nativeReleased = true; owned.exitCode = 0; });
    await manager.stop();
    expect(internals.startupProcess).toBeNull();
    expect(processMethods.forceTerminateManagedProcessTree).toHaveBeenCalledTimes(2);
    expect(processMethods.forceTerminateManagedProcessTree.mock.calls.every(call => call[0] === child)).toBe(true);
  });

  it('retains a failed identity probe owner and retries the same Job before permitting another start', async () => {
    const manager = configureManager(new FakeTransport(), vi.fn());
    const probe = new FakeChild(4242); probe.nativeReleased = false;
    const internals = manager as unknown as { startupProcess: FakeChild | null };
    internals.startupProcess = probe;
    processMethods.forceTerminateManagedProcessTree.mockRejectedValueOnce(new Error('probe recovery denied'));
    await expect(manager.stop()).rejects.toThrow('probe recovery denied');
    expect(internals.startupProcess).toBe(probe);
    await expect(manager.start()).rejects.toThrow('上代进程尚未释放');
    processMethods.forceTerminateManagedProcessTree.mockImplementation(async (child: FakeChild) => { child.nativeReleased = true; child.exitCode = 0; });
    await manager.stop();
    expect(internals.startupProcess).toBeNull();
    expect(processMethods.forceTerminateManagedProcessTree).toHaveBeenCalledTimes(2);
    expect(processMethods.forceTerminateManagedProcessTree.mock.calls.every(call => call[0] === probe)).toBe(true);
  });
  it('revokes readiness and registration when the Native helper exits without a root receipt', async () => {
    const transport = new FakeTransport();
    transport.isRegistered = true;
    const manager = configureManager(transport, vi.fn());
    const child = new FakeChild(4343);
    child.nativeReleased = false;
    const internals = manager as unknown as { child: FakeChild | null; running: boolean; ready: boolean; attachProcessObservers(child: FakeChild): void };
    internals.child = child;
    internals.running = internals.ready = true;
    transport.prepareProcess();
    internals.attachProcessObservers(child);
    child.exitCode = 1;
    child.emit('exit', 1, null);
    expect(manager.isReady).toBe(false);
    expect(internals.child).toBe(child);
    expect(transport.activeSecret).toBeNull();
    expect(transport.invalidations.at(-1)?.processId).toBe(4343);
    await expect(manager.start()).rejects.toThrow('上代进程尚未释放');
    processMethods.stopManagedProcess.mockRejectedValueOnce(new Error('release receipt missing'));
    await expect(manager.stop()).rejects.toThrow('release receipt missing');
    expect(internals.child).toBe(child);
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
