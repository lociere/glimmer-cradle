import { randomUUID } from 'node:crypto';
import type {
  ExtensionHostMessage,
  ExtensionHostMethod,
  ExtensionRpcResponse,
  ExtensionWorkerRequest,
} from '@glimmer-cradle/protocol';
import type { Disposable } from '../../foundation/ports';
import type { ExtensionWorkerContext, LoadedExtensionModule } from './extension-worker-module';

type Handler = (...args: unknown[]) => unknown | Promise<unknown>;

const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const handlers = new Map<string, Handler>();
let extension: LoadedExtensionModule | null = null;
let context: ExtensionWorkerContext | null = null;
let stopping = false;
let activationRegistrations: Promise<string>[] | null = null;

process.on('message', (message: ExtensionHostMessage) => {
  if (message.channel === 'extension-rpc-response') {
    settle(message);
    return;
  }
  if (message.channel === 'extension-worker-request') {
    void handleWorkerRequest(message);
  }
});

process.on('disconnect', () => {
  void deactivate().finally(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  fire('log', { level: 'error', message: 'Extension Host uncaughtException', meta: { error: error.message, stack: error.stack } });
  void deactivate().finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  fire('log', { level: 'error', message: 'Extension Host unhandledRejection', meta: { error: String(reason) } });
});

send({ channel: 'extension-worker-ready', pid: process.pid });

async function handleWorkerRequest(message: ExtensionWorkerRequest): Promise<void> {
  try {
    let result: unknown;
    if (message.method === 'activate') result = await activate(message.payload);
    else if (message.method === 'deactivate') result = await deactivate();
    else result = await invokeHandler(message.payload);
    respond(message.request_id, true, result);
  } catch (error) {
    respond(message.request_id, false, undefined, error instanceof Error ? error.message : String(error));
  }
}

async function activate(payload: unknown): Promise<{ ready: true }> {
  if (extension) return { ready: true };
  const input = asRecord(payload);
  const extensionId = readString(input.extension_id);
  const entryPath = readString(input.entry_path);
  const rawConfig = asRecord(input.config);
  if (!extensionId || !entryPath) throw new Error('Extension Host 缺少 extension_id 或 entry_path');

  // The extension package is loaded only inside this process boundary.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const requiredModule = require(entryPath);
  const exported = requiredModule.default ?? requiredModule;
  const candidate = exported?.extension ?? exported;
  if (!candidate || typeof candidate.onActivate !== 'function') {
    throw new Error(`扩展入口没有导出合法模块: ${extensionId}`);
  }
  extension = candidate as LoadedExtensionModule;
  const config = validateConfig(extension, rawConfig, extensionId);
  context = createContext(extensionId, config);
  const registrations: Promise<string>[] = [];
  activationRegistrations = registrations;
  try {
    await extension.onActivate(context);
    await Promise.all(registrations);
    return { ready: true };
  } catch (error) {
    await deactivate();
    throw error;
  } finally {
    activationRegistrations = null;
  }
}

async function deactivate(): Promise<{ stopped: true }> {
  if (stopping) return { stopped: true };
  stopping = true;
  try {
    if (extension?.onDeactivate) await extension.onDeactivate();
  } finally {
    if (context) {
      for (const subscription of [...context.subscriptions].reverse()) {
        try { await subscription.dispose(); } catch { /* continue releasing the boundary */ }
      }
      context.subscriptions.length = 0;
    }
    handlers.clear();
    extension = null;
    context = null;
    stopping = false;
  }
  return { stopped: true };
}

function createContext(extensionId: string, config: Record<string, unknown>): ExtensionWorkerContext {
  const subscriptions: Disposable[] = [];
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
        get: (key) => request('storage.get', { key }),
        set: async (key, value) => { await request('storage.set', { key, value }); },
        delete: async (key) => { await request('storage.delete', { key }); },
      },
      evidenceProposal: { submit: async (proposal) => { await request('evidence.submit', proposal); } },
      perception: { inject: (proposal) => fire('perception.inject', proposal) },
      sceneAttention: {
        requestAttentionLease: (lease) => deferredRegistration('attention.acquire', lease),
        isSceneFocused: async (channelId) => Boolean(await request('attention.focused', { channel_id: channelId })),
        registerSourcePolicies: (policies) => fire('attention.policies', { policies }),
      },
      events: {
        on: (eventName: string, handler: (payload: unknown) => void) => {
          const handlerId = registerHandler(handler);
          return deferredRegistration('events.subscribe', { event_name: eventName, handler_id: handlerId }, handlerId);
        },
        emit: (eventName: string, payload: unknown) => fire('events.emit', { event_name: eventName, payload }),
      },
      agents: {
        registerSubAgent: (profile) => {
          const tools = profile.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            audience: tool.audience,
            scope: tool.scope,
            requirements: tool.requirements,
            parameters: tool.parameters,
            handler_id: registerHandler((args) => tool.handler(args)),
          }));
          return deferredRegistration('agents.register', { profile: { ...profile, tools } }, tools.map((tool) => tool.handler_id));
        },
      },
      commands: {
        registerCommand: (commandId, handler, metadata) => {
          const handlerId = registerHandler((args) => handler(...(Array.isArray(args) ? args : [])));
          return deferredRegistration('commands.register', {
            command_id: commandId,
            handler_id: handlerId,
            metadata,
          }, handlerId);
        },
        executeCommand: (commandId, ...args) => request('commands.execute', { command_id: commandId, args }),
        listCommands: async () => (await request('commands.list', {})) as never,
      },
      runtime: {
        reportCapabilityGraph: async (report) => { await request('runtime.capabilities', report); },
        reportDiagnostics: async (diagnostics) => { await request('runtime.diagnostics', diagnostics); },
      },
    },
  };
}

function deferredRegistration(method: Parameters<typeof request>[0], payload: unknown, handlerIds: string | string[] = []): Disposable {
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

function request(method: ExtensionHostMethod, payload: unknown): Promise<unknown> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    send({ channel: 'extension-host-request', request_id: requestId, method, payload });
  });
}

function fire(method: ExtensionHostMethod, payload: unknown): void {
  void request(method, payload).catch(() => undefined);
}

function settle(message: ExtensionRpcResponse): void {
  const waiter = pending.get(message.request_id);
  if (!waiter) return;
  pending.delete(message.request_id);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error ?? 'Extension Host RPC failed'));
}

function respond(requestId: string, ok: boolean, result?: unknown, error?: string): void {
  send({ channel: 'extension-rpc-response', request_id: requestId, ok, result, error });
}

function send(message: ExtensionHostMessage): void {
  if (process.connected && process.send) process.send(message);
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

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
