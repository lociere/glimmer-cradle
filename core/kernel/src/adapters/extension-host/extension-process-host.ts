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
  type ExtensionManifest,
  type ExtensionPermission as ExtensionPermissionValue,
} from '@glimmer-cradle/extension-sdk';
import type {
  ExtensionHostProcessMessage,
  ExtensionHostProcessResponse,
  ExtensionHostProcessStage,
  ExtensionKernelRequest,
  ExtensionHostProcessMethod,
} from '@glimmer-cradle/extension-host/process-protocol';
import { ErrorCode } from '../../domain/error-code';
import { ExtensionException } from '../../domain/errors';
import type { Disposable, ExtensionAgentRegistration, IExtensionHostService } from '../../ports';
import { ManagedProcessSupervisor } from '@glimmer-cradle/platform';
import { getLogger } from '../observability/logger';
import { resolveManagedProcessBridge } from '../filesystem/path-utils';

const processSupervisor = new ManagedProcessSupervisor(getLogger('extension-process-supervisor'));

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
  private readonly runtimeId: string;
  private stopping = false;
  private active = false;
  private closing = false;
  private stopOperation: Promise<void> | undefined;
  private readonly disposing = new Map<string, Promise<void>>();

  public constructor(
    private readonly service: IExtensionHostService,
    private readonly manifest: Manifest,
    private readonly entryPath: string,
    private readonly config: Record<string, unknown>,
    private readonly secrets: Record<string, string>,
    private readonly activationProfile: string,
    private readonly timeoutMs: number,
  ) {
    this.runtimeId = `extension.${manifest.id}.${randomUUID()}`;
  }

  public async start(): Promise<void> {
    if (this.child) {
      if (this.active && !this.stopping) return;
      throw new Error('Extension Host 上代进程尚未释放，拒绝并行启动');
    }
    if (this.registrations.size > 0 || this.stopOperation) throw new Error('Extension Host 旧资源尚未释放');
    this.closing = false;
    const hostEntry = resolveExtensionHostEntry();
    const useTypeScript = hostEntry.endsWith('.ts');
    const child = processSupervisor.forkManagedProcess(hostEntry, [], {
      cwd: path.dirname(this.entryPath),
      env: {
        ...process.env,
        GLIMMER_CRADLE_EXTENSION_ID: this.manifest.id,
        GLIMMER_CRADLE_EXTENSION_RUNTIME_ID: this.runtimeId,
        NODE_PATH: buildExtensionModulePath(),
      },
      execArgv: useTypeScript ? ['--import', pathToFileURL(require.resolve('tsx')).href] : [],
      detached: process.platform !== 'win32',
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }, resolveManagedProcessBridge(), fork);
    this.child = child;
    processSupervisor.observeManagedProcess(child, process.platform !== 'win32');
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    child.on('message', (message: ExtensionHostProcessMessage) => { if (this.child === child) this.onMessage(message); });
    child.once('disconnect', () => { if (this.child === child) this.onDisconnect(); });
    child.once('error', (error) => { if (this.child === child) this.onExit(error); });
    processSupervisor.onManagedProcessExit(child, (code, signal) => {
      if (this.child !== child) return;
      const cleanExit = this.stopping || code === 0;
      this.onExit(cleanExit ? null : new Error(`Extension Host 退出: code=${code}, signal=${signal}`));
    });
    this.forwardOutput(child.stdout, 'debug');
    this.forwardOutput(child.stderr, 'warn');

    processSupervisor.onManagedProcessRootExit(child, (code, signal) => {
      if (this.child === child) this.onExit(this.stopping || code === 0 ? null : new Error(`Extension Host 根退出: code=${code}, signal=${signal}`));
    });
    await processSupervisor.waitForManagedProcessReady(child, this.timeoutMs);
    await withTimeout(this.readyPromise, this.timeoutMs, `扩展 ${this.manifest.id} Host 启动超时`);
    await this.request('activate', {
      extension_id: this.manifest.id,
      activation_profile: this.activationProfile,
      entry_path: this.entryPath,
      config: hasExtensionPermission(ExtensionPermission.CONFIG_READ_SELF, this.manifest.permissions) ? this.config : {},
    });
    if (this.child !== child || this.closing || this.stopOperation || !processSupervisor.isManagedProcessRootRunning(child)) throw new Error("Extension Host 启动世代已关闭");
    this.active = true;
  }

  public invokeHandler(handlerId: string, args: unknown): Promise<unknown> {
    if (!this.active || this.stopping) return Promise.reject(new Error('Extension Host 尚未就绪或正在关闭'));
    return this.request('handler.invoke', { handler_id: handlerId, args });
  }

  public stop(): Promise<void> {
    if (this.stopOperation) return this.stopOperation;
    let resolveStop!: () => void;
    let rejectStop!: (error: unknown) => void;
    const stopping = new Promise<void>((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
    this.stopOperation = stopping;
    void this.stopChild().then(resolveStop, rejectStop);
    void stopping.then(() => { this.stopOperation = undefined; }, () => { this.stopOperation = undefined; });
    return stopping;
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.active = false;
    this.closing = true;
    this.stopping = true;
    const failures: unknown[] = [];
    try {
      if (child?.connected) await this.request('deactivate', undefined).catch(() => undefined);
    } finally {
      try { await this.disposeRegistrations(); } catch (error) { failures.push(error); }
      try {
        if (child?.connected) child.disconnect();
        if (child) {
          if (!(await processSupervisor.waitForManagedProcessExit(child, 1500)) || !processSupervisor.isProcessReleased(child)) {
            await processSupervisor.forceTerminateManagedProcessTree(child, `Extension Host ${this.manifest.id}`, 1500, process.platform !== 'win32');
          }
          if (this.child === child) this.child = null;
        }
      } catch (error) { failures.push(error); }
      this.rejectPending(new Error(`Extension Host ${this.manifest.id} 已停止接纳`));
      this.stopping = false;
      if (failures.length > 0) {
        this.reportHostStage('failed', `Extension Host ${this.manifest.id} 停机未确认`);
        throw new AggregateError(failures, 'Extension Host 资源释放失败');
      }
      this.reportHostStage('stopped', `Extension Host ${this.manifest.id} stopped`);
    }
  }

  private onMessage(message: ExtensionHostProcessMessage): void {
    if (message.channel === 'extension-host-process-ready') {
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      this.reportHostStage('connected', `Extension Host process connected pid=${message.pid}`);
      return;
    }
    if (message.channel === 'extension-host-process-state') {
      this.reportHostStage(message.stage, message.summary, message.error);
      return;
    }
    if (message.channel === 'extension-host-process-response') {
      this.settle(message);
      return;
    }
    if (message.channel === 'extension-kernel-request') {
      void this.handleHostRequest(message);
    }
  }

  private async handleHostRequest(message: ExtensionKernelRequest): Promise<void> {
    try {
      const result = await this.dispatchHostRequest(message);
      this.respond(message.request_id, true, result);
    } catch (error) {
      this.respond(message.request_id, false, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  private async dispatchHostRequest(message: ExtensionKernelRequest): Promise<unknown> {
    if (this.closing) throw new Error('Extension Host 正在关闭，拒绝新请求');
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
      case 'secrets.get': {
        this.assertPermission(ExtensionPermission.SECRET_READ_SELF, '读取自身 Secret');
        const key = readString(payload.key);
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) {
          throw new ExtensionException(`扩展 Secret key 非法: ${key}`, ErrorCode.EXTENSION_VALIDATION_FAILED);
        }
        return this.secrets[key];
      }
      case 'evidence.submit':
        this.assertPermission(ExtensionPermission.EVIDENCE_PROPOSAL_WRITE, '提交认知证据候选');
        await this.service.submitEvidenceProposal(this.manifest.id, payload as never); return null;
      case 'perception.inject':
        this.assertPermission(ExtensionPermission.PERCEPTION_WRITE, '注入感知事件');
        await this.service.injectPerception(this.manifest.id, payload as never); return null;
      case 'asset.begin':
        this.assertPermission(ExtensionPermission.PERCEPTION_WRITE, '暂存感知资产');
        return this.service.beginAssetUpload(this.manifest.id, {
          mediaType: readString(payload.mediaType), sizeBytes: Number(payload.sizeBytes), sha256: readString(payload.sha256),
        });
      case 'asset.write':
        this.assertPermission(ExtensionPermission.PERCEPTION_WRITE, '写入感知资产');
        await this.service.writeAssetUpload(this.manifest.id, readString(payload.token), payload.chunk as Uint8Array); return null;
      case 'asset.abort':
        this.assertPermission(ExtensionPermission.PERCEPTION_WRITE, '取消感知资产');
        await this.service.abortAssetUpload(this.manifest.id, readString(payload.token)); return null;
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

  private request(method: ExtensionHostProcessMethod, payload: unknown): Promise<unknown> {
    const child = this.child;
    if (!child?.connected) return Promise.reject(new Error(`Extension Host ${this.manifest.id} 未连接`));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Extension Host ${this.manifest.id} 请求超时: ${method}`));
      }, this.timeoutMs);
      timer.unref?.();
      const fail = (error: Error) => {
        const waiter = this.pending.get(requestId);
        if (!waiter) return;
        this.pending.delete(requestId);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      };
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        child.send(
          { channel: 'extension-host-process-request', request_id: requestId, method, payload } satisfies ExtensionHostProcessMessage,
          (error) => {
            if (error) fail(new Error(`Extension Host ${this.manifest.id} 请求发送失败: ${method}; ${error.message}`));
          },
        );
      } catch (error) {
        fail(new Error(`Extension Host ${this.manifest.id} 请求发送失败: ${method}; ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  private settle(message: ExtensionHostProcessResponse): void {
    const waiter = this.pending.get(message.request_id);
    if (!waiter) return;
    this.pending.delete(message.request_id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error ?? 'Extension Host RPC failed'));
  }

  private respond(requestId: string, ok: boolean, result?: unknown, error?: string): void {
    if (!this.child?.connected) return;
    this.child.send({ channel: 'extension-host-process-response', request_id: requestId, ok, result, error } satisfies ExtensionHostProcessMessage);
  }

  private register(disposable: Disposable): string {
    const id = randomUUID();
    this.registrations.set(id, disposable);
    return id;
  }

  private async disposeRegistration(id: string): Promise<void> {
    const disposable = this.registrations.get(id);
    if (!disposable) return;
    let pending = this.disposing.get(id);
    if (!pending) {
      pending = Promise.resolve().then(() => disposable.dispose());
      this.disposing.set(id, pending);
      void pending.then(() => {
        if (this.registrations.get(id) === disposable) this.registrations.delete(id);
        this.disposing.delete(id);
      }, () => { this.disposing.delete(id); });
    }
    await withTimeout(
      pending,
      Math.min(this.timeoutMs, 1500),
      `扩展 ${this.manifest.id} 注册项释放超时: ${id}`,
    );
  }

  private async disposeRegistrations(): Promise<void> {
    const failures: unknown[] = [];
    for (const id of [...this.registrations.keys()].reverse()) {
      try { await this.disposeRegistration(id); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Extension Host 注册资源释放失败');
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

  private onDisconnect(): void {
    this.active = false;
    this.closing = true;
    const error = new Error(`Extension Host ${this.manifest.id} IPC disconnected`);
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.rejectPending(error);
    if (!this.stopping) {
      void this.disposeRegistrations().catch(() => this.reportHostStage('failed', 'Extension Host 注册资源释放失败'));
      this.reportHostStage('failed', `Extension Host ${this.manifest.id} IPC disconnected`, error.message);
    }
  }

  private onExit(error: Error | null): void {
    this.active = false;
    this.closing = true;
    if (error) this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    const released = !this.child?.pid || processSupervisor.isProcessReleased(this.child);
    if (released) this.child = null;
    this.rejectPending(error ?? new Error(`Extension Host ${this.manifest.id} exited`));
    const cleanup = this.disposeRegistrations();
    void cleanup.then(() => {
      if (!error && released && !this.stopping && !this.child) this.reportHostStage('stopped', `Extension Host ${this.manifest.id} process exited`);
    }, () => this.reportHostStage('failed', 'Extension Host 注册资源释放失败'));
    if (error) {
      this.reportHostStage('failed', `Extension Host ${this.manifest.id} process exited`, error.message);
    }
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

  private reportHostStage(stage: ExtensionHostProcessStage, summary?: string, error?: string): void {
    const safeSummary = summary || `Extension Host ${this.manifest.id} stage=${stage}`;
    if (stage === 'failed') {
      this.service.updateExtensionRuntimeLifecycle(this.manifest.id, 'failed', safeSummary, error);
      return;
    }
    if (stage === 'degraded') {
      this.service.updateExtensionRuntimeLifecycle(this.manifest.id, 'degraded', safeSummary, error);
      return;
    }
    if (stage === 'stopped') {
      this.service.updateExtensionRuntimeLifecycle(this.manifest.id, 'stopped', safeSummary);
      return;
    }
    this.service.updateExtensionDiagnostics(this.manifest.id, {
      summary: safeSummary,
      trace_id: this.runtimeId,
      last_error: error,
      entries: [],
      log_locations: [],
      recovery_actions: [],
    });
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

function resolveExtensionHostEntry(): string {
  const explicit = process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY?.trim();
  if (explicit) return explicit;
  try {
    return require.resolve('@glimmer-cradle/extension-host');
  } catch {
    const source = path.resolve(__dirname, '../../../../../hosts/extension-host/src/main.ts');
    return fs.existsSync(source)
      ? source
      : path.resolve(__dirname, '../../../../../hosts/extension-host/dist/main.js');
  }
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
