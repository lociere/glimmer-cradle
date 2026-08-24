import { randomUUID } from 'node:crypto';
import type {
  ExtensionHostProcessErrorCode,
  ExtensionHostProcessMessage,
  ExtensionHostProcessRequest,
  ExtensionHostProcessResponse,
  ExtensionHostProcessStage,
  ExtensionKernelMethod,
  ExtensionKernelRequest,
} from './process-protocol';
import type {
  Disposable,
  ExtensionHostContext,
  LoadedExtensionModule,
} from './application/extension-module';
import { createDisposableRegistry } from './application/extension-module';

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

const runtimeId = process.env.GLIMMER_CRADLE_EXTENSION_RUNTIME_ID
  || `extension-host:${process.env.GLIMMER_CRADLE_EXTENSION_ID || 'unknown'}:${process.pid}`;
const pending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>();
const handlers = new Map<string, Handler>();
const timers = new Set<NodeJS.Timeout>();
const disposables = createDisposableRegistry();
const requestTimeoutMs = readPositiveInteger(process.env.GLIMMER_CRADLE_EXTENSION_HOST_IPC_REQUEST_TIMEOUT_MS, 2000);
const deactivationTimeoutMs = readPositiveInteger(process.env.GLIMMER_CRADLE_EXTENSION_HOST_DEACTIVATE_TIMEOUT_MS, 3000);

let extension: LoadedExtensionModule | null = null;
let context: ExtensionHostContext | null = null;
let stopping = false;
let ipcClosed = !process.connected;
let activationRegistrations: Promise<string>[] | null = null;
let deactivationPromise: Promise<{ stopped: true }> | null = null;

process.on('message', (message: ExtensionHostProcessMessage) => {
  if (message.channel === 'extension-host-process-response') {
    settle(message);
    return;
  }
  if (message.channel === 'extension-host-process-request') {
    void handleHostProcessRequest(message);
  }
});

process.on('disconnect', () => {
  closeIpc('Extension Host IPC disconnected');
  void deactivate().finally(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  reportStage('failed', 'Extension Host uncaughtException', error);
  fire('log', { level: 'error', message: 'Extension Host uncaughtException', meta: safeErrorMeta(error) });
  void deactivate().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  reportStage('degraded', 'Extension Host unhandledRejection', error);
  fire('log', { level: 'error', message: 'Extension Host unhandledRejection', meta: safeErrorMeta(error) });
});

reportStage('process_alive', 'Extension Host process alive.');
send({ channel: 'extension-host-process-ready', runtime_id: runtimeId, pid: process.pid });
reportStage('connected', 'Extension Host IPC connected.');

async function handleHostProcessRequest(message: ExtensionHostProcessRequest): Promise<void> {
  try {
    let result: unknown;
    if (message.method === 'activate') result = await activate(message.payload);
    else if (message.method === 'deactivate') result = await deactivate();
    else result = await invokeHandler(message.payload);
    respond(message.request_id, true, result);
  } catch (error) {
    reportStage('failed', 'Extension Host request failed.', error);
    respond(message.request_id, false, undefined, error instanceof Error ? error.message : String(error));
  }
}

async function activate(payload: unknown): Promise<{ ready: true; runtime_id: string }> {
  if (extension) return { ready: true, runtime_id: runtimeId };
  const input = asRecord(payload);
  const extensionId = readString(input.extension_id);
  const entryPath = readString(input.entry_path);
  const rawConfig = asRecord(input.config);
  if (!extensionId || !entryPath) throw new Error('Extension Host 缺少 extension_id 或 entry_path');

  reportStage('handshake', `Extension Host handshake accepted for ${extensionId}.`);
  const exported = loadExtensionEntry(entryPath);
  const candidate = exported?.extension ?? exported;
  if (!isLoadedExtensionModule(candidate)) {
    throw new Error(`扩展入口没有导出合法模块: ${extensionId}`);
  }
  extension = candidate;
  const config = validateConfig(extension, rawConfig, extensionId);
  context = createContext(extensionId, config);
  reportStage('resource_prepared', `Extension ${extensionId} context prepared.`);
  const registrations: Promise<string>[] = [];
  activationRegistrations = registrations;
  try {
    await extension.onActivate(context);
    await Promise.all(registrations);
    reportStage('ready', `Extension ${extensionId} activated.`);
    return { ready: true, runtime_id: runtimeId };
  } catch (error) {
    await deactivate();
    throw error;
  } finally {
    activationRegistrations = null;
  }
}

async function deactivate(): Promise<{ stopped: true }> {
  if (deactivationPromise) return deactivationPromise;
  deactivationPromise = runDeactivate().finally(() => {
    deactivationPromise = null;
  });
  return deactivationPromise;
}

async function runDeactivate(): Promise<{ stopped: true }> {
  if (stopping) return { stopped: true };
  stopping = true;
  let firstError: Error | null = null;
  reportStage('stopping', 'Extension Host stopping.');
  try {
    if (extension?.onDeactivate) {
      await withDeadline(
        Promise.resolve(extension.onDeactivate()),
        deactivationTimeoutMs,
        'Extension Host onDeactivate timeout',
      );
    }
  } catch (error) {
    firstError = asError(error);
    reportStage('failed', 'Extension Host onDeactivate failed.', firstError);
  } finally {
    try {
      await withDeadline(disposables.disposeAll(), deactivationTimeoutMs, 'Extension Host disposeAll timeout');
    } catch (error) {
      firstError ??= asError(error);
      reportStage('failed', 'Extension Host disposeAll failed.', error);
    }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    rejectPending(new ExtensionHostIpcError('ipc_disconnected', 'Extension Host stopping'));
    handlers.clear();
    extension = null;
    context = null;
    stopping = false;
    reportStage('stopped', 'Extension Host stopped.');
  }
  if (firstError && !ipcClosed) throw firstError;
  return { stopped: true };
}

function createContext(extensionId: string, config: Record<string, unknown>): ExtensionHostContext {
  const subscriptions: Disposable[] = [];
  const track = (disposable: Disposable): Disposable => {
    subscriptions.push(disposable);
    return disposables.add(disposable);
  };
  return {
    extensionId,
    config: Object.freeze(config),
    subscriptions,
    logger: {
      debug: (message, meta) => fire('log', { level: 'debug', message, meta }),
      info: (message, meta) => fire('log', { level: 'info', message, meta }),
      warn: (message, meta) => fire('log', { level: 'warn', message, meta }),
      error: (message, meta) => fire('log', { level: 'error', message, meta }),
    },
    ports: {
      storage: {
        get: (key: string) => request('storage.get', { key }),
        set: async (key: string, value: unknown) => { await request('storage.set', { key, value }); },
        delete: async (key: string) => { await request('storage.delete', { key }); },
      },
      evidenceProposal: { submit: async (proposal: unknown) => { await request('evidence.submit', proposal); } },
      perception: { inject: (proposal: unknown) => fire('perception.inject', proposal) },
      sceneAttention: {
        requestAttentionLease: (lease: unknown) => track(deferredRegistration('attention.acquire', lease)),
        isSceneFocused: async (channelId: string) => Boolean(await request('attention.focused', { channel_id: channelId })),
        registerSourcePolicies: (policies: Record<string, string>) => fire('attention.policies', { policies }),
      },
      events: {
        on: (eventName: string, handler: (payload: unknown) => void) => {
          const handlerId = registerHandler(handler);
          return track(deferredRegistration('events.subscribe', { event_name: eventName, handler_id: handlerId }, handlerId));
        },
        emit: (eventName: string, payload: unknown) => fire('events.emit', { event_name: eventName, payload }),
      },
      agents: {
        registerSubAgent: (profile: Record<string, any>) => {
          const tools = (Array.isArray(profile.tools) ? profile.tools : []).map((tool: Record<string, any>) => ({
            name: tool.name,
            description: tool.description,
            audience: tool.audience,
            scope: tool.scope,
            requirements: tool.requirements,
            parameters: tool.parameters,
            handler_id: registerHandler((args) => tool.handler(args)),
          }));
          return track(deferredRegistration('agents.register', { profile: { ...profile, tools } }, tools.map((tool) => tool.handler_id)));
        },
      },
      commands: {
        registerCommand: (commandId: string, handler: (...args: unknown[]) => unknown, metadata?: Record<string, unknown>) => {
          const handlerId = registerHandler((args) => handler(...(Array.isArray(args) ? args : [])));
          return track(deferredRegistration('commands.register', {
            command_id: commandId,
            handler_id: handlerId,
            metadata,
          }, handlerId));
        },
        executeCommand: (commandId: string, ...args: unknown[]) => request('commands.execute', { command_id: commandId, args }),
        listCommands: async () => (await request('commands.list', {})) as never,
      },
      runtime: {
        reportCapabilityGraph: async (report: unknown) => { await request('runtime.capabilities', report); },
        reportDiagnostics: async (diagnostics: unknown) => { await request('runtime.diagnostics', diagnostics); },
      },
    },
  };
}

function deferredRegistration(method: ExtensionKernelMethod, payload: unknown, handlerIds: string | string[] = []): Disposable {
  let disposed = false;
  const ids = Array.isArray(handlerIds) ? handlerIds : [handlerIds];
  const registration = request(method, payload).then((value) => readString(asRecord(value).registration_id));
  activationRegistrations?.push(registration);
  return {
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      ids.filter(Boolean).forEach((id) => handlers.delete(id));
      const registrationId = await registration.catch(() => '');
      if (registrationId) await request('registration.dispose', { registration_id: registrationId }).catch(() => undefined);
    },
  };
}

function registerHandler(handler: Handler): string {
  const id = randomUUID();
  handlers.set(id, handler);
  return id;
}

async function invokeHandler(payload: unknown): Promise<unknown> {
  const input = asRecord(payload);
  const handler = handlers.get(readString(input.handler_id));
  if (!handler) throw new Error('Extension Host handler 已释放');
  return handler(input.args);
}

function request(method: ExtensionKernelMethod, payload: unknown): Promise<unknown> {
  const sendToParent = process.send;
  if (ipcClosed || !process.connected || !sendToParent) {
    return Promise.reject(new ExtensionHostIpcError('ipc_disconnected', `Extension Host IPC disconnected before ${method}`));
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      timers.delete(timeout);
      reject(new ExtensionHostIpcError('ipc_request_timeout', `Extension Host IPC request timeout: ${method}`));
    }, requestTimeoutMs);
    timeout.unref?.();
    timers.add(timeout);
    const fail = (error: Error) => {
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      clearTimeout(timeout);
      timers.delete(timeout);
      waiter.reject(error);
    };
    pending.set(requestId, { resolve, reject, timer: timeout });
    try {
      sendToParent.call(process, { channel: 'extension-kernel-request', request_id: requestId, method, payload } satisfies ExtensionHostProcessMessage, (error) => {
        if (error) fail(new ExtensionHostIpcError('ipc_send_failed', error.message));
      });
    } catch (error) {
      fail(new ExtensionHostIpcError('ipc_send_failed', error instanceof Error ? error.message : String(error)));
    }
  });
}

function fire(method: ExtensionKernelMethod, payload: unknown): void {
  void request(method, payload).catch(() => undefined);
}

function settle(message: ExtensionHostProcessResponse): void {
  const waiter = pending.get(message.request_id);
  if (!waiter) return;
  pending.delete(message.request_id);
  clearTimeout(waiter.timer);
  timers.delete(waiter.timer);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error ?? 'Extension Host RPC failed'));
}

function respond(requestId: string, ok: boolean, result?: unknown, error?: string): void {
  send({ channel: 'extension-host-process-response', request_id: requestId, ok, result, error });
}

function reportStage(stage: ExtensionHostProcessStage, summary: string, error?: unknown): void {
  send({
    channel: 'extension-host-process-state',
    runtime_id: runtimeId,
    stage,
    pid: process.pid,
    summary,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
  });
}

function send(message: ExtensionHostProcessMessage): void {
  if (process.connected && process.send) process.send(message);
}

function closeIpc(message: string): void {
  ipcClosed = true;
  rejectPending(new ExtensionHostIpcError('ipc_disconnected', message));
}

function rejectPending(error: Error): void {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    timers.delete(waiter.timer);
    waiter.reject(error);
  }
  pending.clear();
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new ExtensionHostIpcError('deactivation_timeout', message)), timeoutMs);
    timeout.unref?.();
    timers.add(timeout);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
      timers.delete(timeout);
    }
  }
}

class ExtensionHostIpcError extends Error {
  public constructor(public readonly code: ExtensionHostProcessErrorCode, message: string) {
    super(`${code}: ${message}`);
  }
}

function loadExtensionEntry(entryPath: string): Record<string, unknown> {
  // Third-party extension code is loaded exclusively inside this Host process.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const requiredModule = require(entryPath);
  return (requiredModule.default ?? requiredModule) as Record<string, unknown>;
}

function isLoadedExtensionModule(value: unknown): value is LoadedExtensionModule {
  return Boolean(value) && typeof value === 'object' && typeof (value as { onActivate?: unknown }).onActivate === 'function';
}

function validateConfig(module: LoadedExtensionModule, raw: Record<string, unknown>, extensionId: string): Record<string, unknown> {
  if (!module.configSchema) return raw;
  const parsed = module.configSchema.safeParse(raw);
  if (parsed.success) return parsed.data as Record<string, unknown>;
  const detail = (parsed.error.issues ?? [])
    .map((issue) => `${(issue.path ?? []).join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`扩展配置校验失败: ${extensionId}; ${detail || 'unknown validation error'}`);
}

function safeErrorMeta(error: Error): Record<string, unknown> {
  return { error: error.message, stack: error.stack };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readPositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
