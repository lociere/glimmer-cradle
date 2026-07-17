import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  ExtensionPermission,
  ExtensionSystemEventTopic,
  hasExtensionPermission,
  type ExtensionHostRequest,
  type ExtensionHostMessage,
  type ExtensionManifest,
  type ExtensionPermission as ExtensionPermissionValue,
  type ExtensionRpcResponse,
  type ExtensionWorkerMethod,
} from '@glimmer-cradle/protocol';
import { ErrorCode } from '@glimmer-cradle/protocol';
import { ExtensionException } from '../../foundation/exceptions';
import type { Disposable, ExtensionAgentRegistration, IExtensionHostService } from '../../foundation/ports';
import { forceTerminateManagedProcessTree, waitForManagedProcessExit } from '../../foundation/process/process-supervisor';

type Manifest = Pick<ExtensionManifest, 'id' | 'permissions'>;

const SYSTEM_TOPICS = new Set<string>(Object.values(ExtensionSystemEventTopic));

export class ExtensionProcessHost {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly registrations = new Map<string, Disposable>();
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;

  public constructor(
    private readonly service: IExtensionHostService,
    private readonly manifest: Manifest,
    private readonly entryPath: string,
    private readonly config: Record<string, unknown>,
    private readonly timeoutMs: number,
  ) {}

  public async start(): Promise<void> {
    if (this.child) return;
    const worker = resolveWorkerEntry();
    const useTypeScript = worker.endsWith('.ts');
    const child = fork(worker, [], {
      cwd: path.dirname(this.entryPath),
      env: {
        ...process.env,
        GLIMMER_CRADLE_EXTENSION_ID: this.manifest.id,
        NODE_PATH: buildExtensionModulePath(),
      },
      execArgv: useTypeScript ? ['--import', pathToFileURL(require.resolve('tsx')).href] : [],
      detached: process.platform !== 'win32',
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    child.on('message', (message: ExtensionHostMessage) => this.onMessage(message));
    child.once('error', (error) => this.onExit(error));
    child.once('exit', (code, signal) => this.onExit(new Error(`Extension Host 退出: code=${code}, signal=${signal}`)));
    this.forwardOutput(child.stdout, 'debug');
    this.forwardOutput(child.stderr, 'warn');

    await withTimeout(this.readyPromise, this.timeoutMs, `扩展 ${this.manifest.id} Host 启动超时`);
    await this.request('activate', {
      extension_id: this.manifest.id,
      entry_path: this.entryPath,
      config: hasExtensionPermission(ExtensionPermission.CONFIG_READ_SELF, this.manifest.permissions) ? this.config : {},
    });
  }

  public invokeHandler(handlerId: string, args: unknown): Promise<unknown> {
    return this.request('handler.invoke', { handler_id: handlerId, args });
  }

  public async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      await this.request('deactivate', undefined).catch(() => undefined);
    } finally {
      await this.disposeRegistrations();
      child.disconnect();
      if (!(await waitForManagedProcessExit(child, 1500))) {
        await forceTerminateManagedProcessTree(child, `Extension Host ${this.manifest.id}`, 1500, process.platform !== 'win32');
      }
      this.child = null;
      this.rejectPending(new Error(`Extension Host ${this.manifest.id} 已停止`));
    }
  }

  private onMessage(message: ExtensionHostMessage): void {
    if (message.channel === 'extension-worker-ready') {
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.channel === 'extension-rpc-response') {
      this.settle(message);
      return;
    }
    if (message.channel === 'extension-host-request') {
      void this.handleHostRequest(message);
    }
  }

  private async handleHostRequest(message: ExtensionHostRequest): Promise<void> {
    try {
      const result = await this.dispatchHostRequest(message);
      this.respond(message.request_id, true, result);
    } catch (error) {
      this.respond(message.request_id, false, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  private async dispatchHostRequest(message: ExtensionHostRequest): Promise<unknown> {
    const payload = asRecord(message.payload);
    switch (message.method) {
      case 'log': {
        const logger = this.service.createLogger(`Extension:${this.manifest.id}`);
        const level = readString(payload.level);
        const text = readString(payload.message);
        const meta = asRecord(payload.meta);
        if (level === 'error') logger.error(text, meta);
        else if (level === 'warn') logger.warn(text, meta);
        else if (level === 'debug') logger.debug(text, meta);
        else logger.info(text, meta);
        return null;
      }
      case 'storage.get': return this.service.createStorage(this.manifest.id).get(readString(payload.key));
      case 'storage.set': await this.service.createStorage(this.manifest.id).set(readString(payload.key), payload.value); return null;
      case 'storage.delete': await this.service.createStorage(this.manifest.id).delete(readString(payload.key)); return null;
      case 'evidence.submit':
        this.assertPermission(ExtensionPermission.EVIDENCE_PROPOSAL_WRITE, '提交认知证据候选');
        await this.service.submitEvidenceProposal(this.manifest.id, payload as never); return null;
      case 'perception.inject':
        this.assertPermission(ExtensionPermission.PERCEPTION_WRITE, '注入感知事件');
        await this.service.injectPerception(this.manifest.id, payload as never); return null;
      case 'attention.acquire': {
        const disposable = this.service.requestSceneAttentionLease(this.manifest.id, payload as never);
        return { registration_id: this.register(disposable) };
      }
      case 'attention.focused': return this.service.isSceneFocused(readString(payload.channel_id));
      case 'attention.policies': this.service.registerSourcePolicies(this.manifest.id, asStringRecord(payload.policies)); return null;
      case 'events.subscribe': {
        this.assertPermission(ExtensionPermission.EVENT_SUBSCRIBE, `订阅事件 ${readString(payload.event_name)}`);
        const eventName = readString(payload.event_name);
        this.assertSubscribableTopic(eventName);
        const handlerId = readString(payload.handler_id);
        const disposable = this.service.subscribeEvent(eventName, async (event) => {
          const body = asRecord(event).payload ?? event;
          await this.invokeHandler(handlerId, body);
        });
        return { registration_id: this.register(disposable) };
      }
      case 'events.emit':
        this.assertPermission(ExtensionPermission.EVENT_PUBLISH, `发布事件 ${readString(payload.event_name)}`);
        this.assertPublishableTopic(readString(payload.event_name));
        this.service.publishExtensionEvent(readString(payload.event_name), `${this.manifest.id}-${Date.now()}`, payload.payload);
        return null;
      case 'commands.register': {
        this.assertPermission(ExtensionPermission.COMMAND_REGISTER, `注册命令 ${readString(payload.command_id)}`);
        const handlerId = readString(payload.handler_id);
        const disposable = this.service.registerCommand(
          this.manifest.id,
          readString(payload.command_id),
          (...args) => this.invokeHandler(handlerId, args),
          payload.metadata as never,
        );
        return { registration_id: this.register(disposable) };
      }
      case 'commands.execute':
        this.assertPermission(ExtensionPermission.COMMAND_EXECUTE, `执行命令 ${readString(payload.command_id)}`);
        return this.service.executeCommand(readString(payload.command_id), ...(Array.isArray(payload.args) ? payload.args : []));
      case 'commands.list': return this.service.listCommands();
      case 'agents.register': return this.registerAgent(payload);
      case 'runtime.capabilities':
        this.assertPermission(ExtensionPermission.RUNTIME_PROJECTION_WRITE, '上报扩展能力图投影');
        this.service.mergeExtensionCapabilityGraph(this.manifest.id, payload as never); return null;
      case 'runtime.diagnostics':
        this.assertPermission(ExtensionPermission.RUNTIME_PROJECTION_WRITE, '上报扩展诊断状态');
        this.service.updateExtensionDiagnostics(this.manifest.id, payload as never); return null;
      case 'registration.dispose': await this.disposeRegistration(readString(payload.registration_id)); return null;
    }
  }

  private registerAgent(payload: Record<string, any>): { registration_id: string } {
    const raw = asRecord(payload.profile);
    this.assertPermission(ExtensionPermission.AGENT_REGISTER, `注册子代理 ${readString(raw.name)}`);
    const tools = (Array.isArray(raw.tools) ? raw.tools : []).map((value) => {
      const tool = asRecord(value);
      const handlerId = readString(tool.handler_id);
      return {
        name: readString(tool.name),
        description: readString(tool.description),
        audience: tool.audience,
        scope: tool.scope,
        requirements: tool.requirements,
        parameters: tool.parameters,
        handler: (args: unknown) => this.invokeHandler(handlerId, args),
      };
    });
    const profile: ExtensionAgentRegistration = {
      id: readString(raw.id),
      name: readString(raw.name),
      description: readString(raw.description),
      audience: raw.audience,
      scope: raw.scope,
      requirements: raw.requirements,
      memoryImpact: Boolean(raw.memoryImpact),
      allowInterrupt: raw.allowInterrupt !== false,
      tools,
    };
    return { registration_id: this.register(this.service.registerAgent(this.manifest.id, profile)) };
  }

  private request(method: ExtensionWorkerMethod, payload: unknown): Promise<unknown> {
    const child = this.child;
    if (!child?.connected) return Promise.reject(new Error(`Extension Host ${this.manifest.id} 未连接`));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Extension Host ${this.manifest.id} 请求超时: ${method}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      child.send({ channel: 'extension-worker-request', request_id: requestId, method, payload } satisfies ExtensionHostMessage);
    });
  }

  private settle(message: ExtensionRpcResponse): void {
    const waiter = this.pending.get(message.request_id);
    if (!waiter) return;
    this.pending.delete(message.request_id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error ?? 'Extension Host RPC failed'));
  }

  private respond(requestId: string, ok: boolean, result?: unknown, error?: string): void {
    if (!this.child?.connected) return;
    this.child.send({ channel: 'extension-rpc-response', request_id: requestId, ok, result, error } satisfies ExtensionHostMessage);
  }

  private register(disposable: Disposable): string {
    const id = randomUUID();
    this.registrations.set(id, disposable);
    return id;
  }

  private async disposeRegistration(id: string): Promise<void> {
    const disposable = this.registrations.get(id);
    if (!disposable) return;
    this.registrations.delete(id);
    await disposable.dispose();
  }

  private async disposeRegistrations(): Promise<void> {
    for (const id of [...this.registrations.keys()].reverse()) {
      await this.disposeRegistration(id).catch(() => undefined);
    }
  }

  private assertPermission(permission: ExtensionPermissionValue, action: string): void {
    if (hasExtensionPermission(permission, this.manifest.permissions)) return;
    throw new ExtensionException(
      `扩展 ${this.manifest.id} 缺少权限 ${permission}，无法${action}`,
      ErrorCode.EXTENSION_PERMISSION_DENIED,
    );
  }

  private assertSubscribableTopic(eventName: string): void {
    if (SYSTEM_TOPICS.has(eventName) || eventName.startsWith(`extension.${this.manifest.id}.`)) return;
    throw new ExtensionException(`扩展 ${this.manifest.id} 不允许订阅事件 ${eventName}`, ErrorCode.EXTENSION_PERMISSION_DENIED);
  }

  private assertPublishableTopic(eventName: string): void {
    if (eventName.startsWith(`extension.${this.manifest.id}.`)) return;
    throw new ExtensionException(
      `扩展 ${this.manifest.id} 仅允许发布 extension.${this.manifest.id}.* 命名空间事件`,
      ErrorCode.EXTENSION_PERMISSION_DENIED,
    );
  }

  private onExit(error: Error): void {
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.child = null;
    this.rejectPending(error);
    void this.disposeRegistrations();
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private forwardOutput(stream: NodeJS.ReadableStream | null, level: 'debug' | 'warn'): void {
    if (!stream) return;
    const lines = readline.createInterface({ input: stream });
    const logger = this.service.createLogger(`ExtensionHost:${this.manifest.id}`);
    lines.on('line', (line) => level === 'warn' ? logger.warn(line) : logger.debug(line));
  }
}

function buildExtensionModulePath(): string {
  const moduleRoots: string[] = [];
  const provided = process.env.GLIMMER_CRADLE_EXTENSION_MODULE_ROOT?.trim();
  if (provided) {
    for (const moduleRoot of provided.split(path.delimiter).map((value) => value.trim()).filter(Boolean)) {
      if (!fs.existsSync(path.join(moduleRoot, '@glimmer-cradle', 'extension-sdk'))) {
        throw new Error(`产品提供的 Extension 模块目录无效: ${moduleRoot}`);
      }
      moduleRoots.push(moduleRoot);
    }
  }
  const inherited = process.env.NODE_PATH?.trim();
  if (inherited) moduleRoots.push(...inherited.split(path.delimiter).filter(Boolean));
  return [...new Set(moduleRoots)].join(path.delimiter);
}

function resolveWorkerEntry(): string {
  const source = path.join(__dirname, 'extension-host-worker.ts');
  return fs.existsSync(source) ? source : path.join(__dirname, 'extension-host-worker.js');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readString(value: unknown): string { return typeof value === 'string' ? value : ''; }

function asStringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(asRecord(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
