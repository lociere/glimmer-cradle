import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ManagedProcessSupervisor } from '@glimmer-cradle/platform';
import { resolveHostProcessTreeBridge } from '../adapters/platform/data-paths.js';
import { setTimeout as schedule, clearTimeout as unschedule } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type Message } from '@bufbuild/protobuf';
import { CallMetadataSchema, ServiceErrorCode, ServiceErrorDetailSchema, ServiceRecoveryAction } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { KernelControlService, RegisterCognitionResponseSchema,
  type RegisterCognitionRequest, type PublishStateRequest, type PublishStateResponse,
  type PublishLogRequest, type PublishLogResponse, type PublishActionRequest, type PublishActionResponse,
} from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import { CognitionClient } from '../adapters/protocol/cognition-client.js';
import { HostCapabilityRequestError, type HostCapabilityServicePort } from '../composition/extension-contributions.js';
import { ExecutionRecoveryRequiredError } from '@glimmer-cradle/capabilities';
import { CapabilityService, type ExposeStepRequest, type ExposeStepResponse,
  type CollectKnowledgeResourceRequest, type CollectKnowledgeResourceResponse,
  type ValidateKnowledgeResourceRequest, type ValidateKnowledgeResourceResponse,
  type ReadResourceRequest, type ReadResourceResponse } from '@glimmer-cradle/contracts/glimmer/capabilities/v1/capabilities_pb';
import type { CallMetadata } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';

export interface WorkerSupervisorOptions {
  readonly python_executable: string;
  readonly app_root: string;
  readonly data_root: string;
  readonly console_path: string;
  readonly runtime_document: Readonly<Record<string, unknown>>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly process_tree_bridge?: string;
  readonly startup_timeout_ms: number;
  readonly shutdown_timeout_ms: number;
  readonly request_timeout_ms: number;
  /** 接收方拥有投影与幂等性；缺少真实接收不能伪造首条状态已完成。 */
  readonly accept_state: (request: PublishStateRequest, signal: AbortSignal) => Promise<PublishStateResponse>;
  readonly accept_log?: (request: PublishLogRequest, signal: AbortSignal) => Promise<PublishLogResponse>;
  readonly accept_action?: (request: PublishActionRequest, signal: AbortSignal) => Promise<PublishActionResponse>;
  readonly capability_service?: HostCapabilityServicePort;
}
export interface WorkerSession { readonly endpoint: string; readonly generation: string; }
export interface WorkerSupervisorSnapshot {
  readonly state: 'idle' | 'starting' | 'ready' | 'failed' | 'stopping' | 'stopped';
  readonly generation: string | null;
  readonly process_id: number | null;
  readonly endpoint: string | null;
  readonly control_endpoint: string | null;
  readonly error_code: 'worker_start_failed' | 'worker_exited' | 'worker_control_failed' | null;
  readonly exit_code: number | null;
  readonly forced: boolean;
}

/** 仅监督本实例创建的进程树。现行 KernelControlService 名称留唯一契约原子迁移时收束。 */
export class WorkerSupervisor {
  private readonly options: WorkerSupervisorOptions;
  private readonly document: string;
  private readonly secrets: string[];
  private state: WorkerSupervisorSnapshot = { state: 'idle', generation: null, process_id: null,
    endpoint: null, control_endpoint: null, error_code: null, exit_code: null, forced: false };
  private readonly cancellation = new AbortController();
  private readonly requests = new Set<AbortController>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly clients = new Set<CognitionClient>();
  private readonly listeners = new Set<() => void>();
  private server?: grpc.Server;
  private child?: ChildProcess;
  private pythonProbe?: ChildProcess;
  private lifecycle?: CognitionClient;
  private secret?: Buffer;
  private nonce?: string;
  private firstState = false;
  private registration?: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
  private starting?: Promise<WorkerSession>;
  private stopping?: Promise<void>;
  private reclaiming?: Promise<void>;
  private stoppingRequested = false;
  private readonly processSupervisor = new ManagedProcessSupervisor({ info() {}, warn() {}, error() {} });

  public constructor(options: WorkerSupervisorOptions) {
    if (![options.python_executable, options.app_root, options.data_root, options.console_path]
      .every(value => typeof value === 'string' && path.isAbsolute(value))
      || ![options.startup_timeout_ms, options.shutdown_timeout_ms, options.request_timeout_ms]
        .every(value => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647)
      || options.request_timeout_ms > options.startup_timeout_ms || typeof options.accept_state !== 'function'
      || !options.runtime_document || typeof options.runtime_document !== 'object' || Array.isArray(options.runtime_document)) {
      throw new Error('Worker supervisor 装配参数无效');
    }
    this.options = { ...options, environment: { ...options.environment },
      process_tree_bridge: resolveHostProcessTreeBridge(options.app_root, options.process_tree_bridge) };
    this.document = JSON.stringify(options.runtime_document);
    if (!this.document || this.document === 'null') throw new Error('Worker 配置 Document 无效');
    const sensitive: string[] = [];
    const inspect = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && /api.?key|password|secret|token/i.test(key) && item) sensitive.push(item);
        else if (typeof item === 'object') inspect(item);
      }
    };
    inspect(options.runtime_document);
    for (const [key, value] of Object.entries({ ...process.env, ...options.environment })) {
      if (value && /api.?key|password|secret|token/i.test(key)) sensitive.push(value);
    }
    this.secrets = [...new Set(sensitive.flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))].sort((a, b) => b.length - a.length);
  }
  public get snapshot(): WorkerSupervisorSnapshot { return { ...this.state }; }
  public onFailure(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  public createCognitionClient(): CognitionClient {
    if (this.state.state !== 'ready' || !this.state.endpoint || !this.state.generation) throw new Error('Worker 尚未业务 ready');
    const client = new CognitionClient(this.state.endpoint, this.state.generation, this.options.request_timeout_ms);
    this.clients.add(client); return client;
  }
  public start(): Promise<WorkerSession> {
    if (this.stoppingRequested || this.state.state === 'failed') return Promise.reject(new Error('Worker 实例已撤销'));
    if (this.starting) return this.starting;
    this.state = { ...this.state, state: 'starting', generation: randomUUID() };
    this.starting = this.begin(); void this.starting.catch(() => undefined); return this.starting;
  }
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stoppingRequested = true; this.state = { ...this.state, state: 'stopping' };
    this.stopping = Promise.resolve().then(async () => {
      this.cancel();
      await this.starting?.catch(() => undefined);
      try {
        await this.reclaim();
        this.state = { ...this.state, state: 'stopped', endpoint: null };
      } catch (error) {
        this.state = { ...this.state, state: 'failed', error_code: 'worker_control_failed', endpoint: null };
        throw error;
      }
    });
    const stopping = this.stopping;
    void stopping.catch(() => { if (this.stopping === stopping) this.stopping = undefined; });
    return this.stopping;
  }
  private async begin(): Promise<WorkerSession> {
    const timer = setTimeout(() => this.cancellation.abort(new Error('Worker startup deadline 已到期')), this.options.startup_timeout_ms);
    try {
      this.secret = randomBytes(32); this.nonce = randomUUID();
      this.registration = deferred(); void this.registration.promise.catch(() => undefined);
      const server = new grpc.Server(); this.server = server;
      const definition = Object.fromEntries(KernelControlService.methods.map(method => [method.name, {
          path: `/${KernelControlService.typeName}/${method.name}`, requestStream: false, responseStream: false,
          requestSerialize: value => Buffer.from(toBinary(method.input, value)), requestDeserialize: bytes => fromBinary(method.input, bytes),
          responseSerialize: value => Buffer.from(toBinary(method.output, value)), responseDeserialize: bytes => fromBinary(method.output, bytes),
        } satisfies grpc.MethodDefinition<Message, Message>]));
      server.addService(definition, {
        RegisterCognition: (call: grpc.ServerUnaryCall<RegisterCognitionRequest, unknown>, callback: grpc.sendUnaryData<unknown>) => {
          try { callback(null, this.register(call.request)); } catch { callback(this.fault(ServiceErrorCode.GENERATION_MISMATCH, call.request.call?.traceId), null); }
        },
        PublishState: (call: grpc.ServerUnaryCall<PublishStateRequest, PublishStateResponse>, callback: grpc.sendUnaryData<PublishStateResponse>) =>
          this.receive(call, callback, async signal => {
            const result = await this.options.accept_state(call.request, signal);
            signal.throwIfAborted();
            this.assertCurrent(call.request.call?.generation);
            if (!result.operationId || !(result.status === 'state_published' || result.status === 'duplicate' && result.duplicate)) {
              throw new Error('状态接纳结果无效');
            }
            this.firstState = true; return result;
          }),
        PublishLog: (call: grpc.ServerUnaryCall<PublishLogRequest, PublishLogResponse>, callback: grpc.sendUnaryData<PublishLogResponse>) =>
          this.receive(call, callback, signal => {
            if (!this.options.accept_log) throw new Error('log receiver 尚未装配');
            return this.options.accept_log(call.request, signal);
          }),
        PublishAction: (call: grpc.ServerUnaryCall<PublishActionRequest, PublishActionResponse>, callback: grpc.sendUnaryData<PublishActionResponse>) =>
          this.receive(call, callback, signal => {
            if (!this.options.accept_action) throw new Error('action receiver 尚未装配');
            return this.options.accept_action(call.request, signal);
          }),
      });
      const capabilities = Object.fromEntries(CapabilityService.methods.map(method => [method.name, {
        path: `/${CapabilityService.typeName}/${method.name}`, requestStream: false, responseStream: false,
        requestSerialize: value => Buffer.from(toBinary(method.input, value)), requestDeserialize: bytes => fromBinary(method.input, bytes),
        responseSerialize: value => Buffer.from(toBinary(method.output, value)), responseDeserialize: bytes => fromBinary(method.output, bytes),
      } satisfies grpc.MethodDefinition<Message, Message>]));
      server.addService(capabilities, {
        CollectKnowledgeResource: (call: grpc.ServerUnaryCall<CollectKnowledgeResourceRequest, CollectKnowledgeResourceResponse>, callback: grpc.sendUnaryData<CollectKnowledgeResourceResponse>) =>
          this.receive(call, callback, signal => this.capabilities().collectKnowledgeResource(call.request, this.principalId(), signal)),
        ValidateKnowledgeResource: (call: grpc.ServerUnaryCall<ValidateKnowledgeResourceRequest, ValidateKnowledgeResourceResponse>, callback: grpc.sendUnaryData<ValidateKnowledgeResourceResponse>) =>
          this.receive(call, callback, signal => this.capabilities().validateKnowledgeResource(call.request, this.principalId(), signal)),
        ExposeStep: (call: grpc.ServerUnaryCall<ExposeStepRequest, ExposeStepResponse>, callback: grpc.sendUnaryData<ExposeStepResponse>) =>
          this.receive(call, callback, signal => this.capabilities().exposeStep(call.request, this.principalId(), signal)),
        ReadResource: (call: grpc.ServerUnaryCall<ReadResourceRequest, ReadResourceResponse>, callback: grpc.sendUnaryData<ReadResourceResponse>) =>
          this.receive(call, callback, signal => this.capabilities().readResource(call.request, this.principalId(), signal), call.request.request?.call),
        InvokeTool: (_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => callback(this.fault(ServiceErrorCode.NOT_READY), null),
        ReadSkill: (_call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) => callback(this.fault(ServiceErrorCode.NOT_READY), null),
      });
      const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
        (error, value) => error ? reject(error) : resolve(value)));
      this.cancellation.signal.throwIfAborted();
      this.state = { ...this.state, control_endpoint: `grpc://127.0.0.1:${port}` };
      mkdirSync(path.dirname(this.options.console_path), { recursive: true });
      const python = await this.resolvePythonProcess();
      this.cancellation.signal.throwIfAborted();
      const child = this.processSupervisor.spawnManagedProcess(python.command, ['-m', 'glimmer_cradle.cognition_worker', '--memory-jobs-owner', 'external'], {
        cwd: this.options.app_root, detached: process.platform !== 'win32', windowsHide: true,
        env: { ...process.env, ...this.options.environment, ...python.environment, GLIMMER_CRADLE_APP_ROOT: this.options.app_root,
          GLIMMER_CRADLE_DATA_ROOT: this.options.data_root, GLIMMER_CRADLE_CONFIG: this.document, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      }, this.options.process_tree_bridge, spawn);
      this.child = child;
      this.capture(child.stdout!); this.capture(child.stderr!);
      this.processSupervisor.onManagedProcessExit(child, code => {
        this.state = { ...this.state, exit_code: code };
        if (!this.stoppingRequested && !this.reclaiming) this.fail('worker_exited');
      });
      this.processSupervisor.onManagedProcessRootExit(child, () => {
        if (!this.stoppingRequested && !this.reclaiming) this.fail('worker_exited');
      });
      child.once('error', () => this.fail('worker_start_failed'));
      if (!child.pid) throw new Error('Worker 未返回受监督 PID');
      const processId = await abortable(this.processSupervisor.waitForManagedProcessReady(child, this.options.startup_timeout_ms), this.cancellation.signal);
      this.cancellation.signal.throwIfAborted();
      if (!this.processSupervisor.isManagedProcessRootRunning(child)) throw new Error('Worker 实际根在接纳前已退出');
      this.state = { ...this.state, process_id: processId };
      const pipe = child.stdio[3] as NodeJS.WritableStream;
      pipe.on('error', () => this.fail('worker_start_failed'));
      pipe.end(JSON.stringify({ kernelEndpoint: `grpc://127.0.0.1:${port}`, generation: this.state.generation,
        registrationNonce: this.nonce, registrationSecret: this.secret.toString('base64url') }) + '\n');
      await abortable(this.registration.promise, this.cancellation.signal);
      this.cancellation.signal.throwIfAborted();
      while (true) {
        const readiness = await this.lifecycle!.readiness(this.cancellation.signal);
        this.cancellation.signal.throwIfAborted();
        if (readiness.generation !== this.state.generation) throw new Error('Worker readiness 世代不匹配');
        if (readiness.state === 'ready' && this.firstState) break;
        if (readiness.state !== 'starting' && readiness.state !== 'ready') throw new Error('Worker 未达到业务 ready');
        await delay(25, undefined, { signal: this.cancellation.signal });
      }
      this.state = { ...this.state, state: 'ready' };
      return { endpoint: this.state.endpoint!, generation: this.state.generation! };
    } catch (error) {
      if (!this.stoppingRequested) this.fail('worker_start_failed');
      await this.reclaim(); throw error;
    } finally { clearTimeout(timer); this.zeroSecret(); }
  }
  private register(request: RegisterCognitionRequest) {
    if (this.state.state !== 'starting' || !this.secret || !this.nonce || !request.call?.traceId
      || request.call.generation !== this.state.generation || request.registrationNonce !== this.nonce) throw new Error('注册能力已失效');
    const pid = Number(request.processId), parent = Number(request.supervisorProcessId);
    // FD3 proof binds the actual interpreter; the Windows Native supervisor is only its parent.
    const expected = this.child && this.processSupervisor.managedProcessPid(this.child);
    const expectedParent = process.platform === 'win32' ? this.child?.pid : process.pid;
    if (![pid, parent].every(value => Number.isSafeInteger(value) && value > 0)
      || pid !== expected || parent !== expectedParent
      || !/^grpc:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(request.endpoint)
      || Number(request.endpoint.split(':').at(-1)) > 65535) throw new Error('受监督进程/端点不匹配');
    const expectedProof = createHmac('sha256', this.secret).update(`${this.state.generation}\n${this.nonce}\n${request.endpoint}\n${pid}\n${parent}`).digest();
    const proof = Buffer.from(request.authProof);
    if (proof.length !== expectedProof.length || !timingSafeEqual(proof, expectedProof)) throw new Error('注册认证失败');
    this.zeroSecret(); this.state = { ...this.state, endpoint: request.endpoint };
    this.options.capability_service?.activatePrincipal(this.principalId(), this.state.generation!);
    this.lifecycle = new CognitionClient(request.endpoint, this.state.generation!, this.options.request_timeout_ms);
    this.registration!.resolve();
    return create(RegisterCognitionResponseSchema, { generation: this.state.generation!, accepted: true });
  }
  private receive<I, O>(call: grpc.ServerUnaryCall<I, O>,
    callback: grpc.sendUnaryData<O>, handler: (signal: AbortSignal) => Promise<O>, header?: CallMetadata): void {
    const metadata = header ?? (call.request as { call?: CallMetadata }).call;
    const cancellation = new AbortController(); this.requests.add(cancellation);
    const timer = setTimeout(() => cancellation.abort(), this.options.request_timeout_ms);
    cancellation.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    call.once('cancelled', () => cancellation.abort());
    const task = (async () => {
      try {
        this.assertCurrent(metadata?.generation);
        if (!metadata?.traceId) throw new Error('缺少 trace');
        const result = await handler(cancellation.signal);
        cancellation.signal.throwIfAborted();
        this.assertCurrent(metadata?.generation);
        callback(null, result);
      } catch (error) {
        const code = metadata?.generation !== this.state.generation ? ServiceErrorCode.GENERATION_MISMATCH
          : error instanceof ExecutionRecoveryRequiredError ? ServiceErrorCode.RECOVERY_REQUIRED
          : cancellation.signal.aborted ? ServiceErrorCode.CANCELLED
          : error instanceof HostCapabilityRequestError ? ServiceErrorCode.INVALID_REQUEST : ServiceErrorCode.NOT_READY;
        callback(this.fault(code, metadata?.traceId, error instanceof ExecutionRecoveryRequiredError ? error.invocationId : ''), null);
      } finally { clearTimeout(timer); this.requests.delete(cancellation); }
    })();
    this.tasks.add(task); void task.finally(() => this.tasks.delete(task)).catch(() => this.fail('worker_control_failed'));
  }
  private assertCurrent(generation?: string): void {
    if (!this.state.endpoint || generation !== this.state.generation || this.cancellation.signal.aborted || this.stoppingRequested) throw new Error('Worker 调用世代已撤销');
  }
  private principalId(): string { return `cognition:${this.state.generation}`; }
  private capabilities(): HostCapabilityServicePort {
    if (!this.options.capability_service || this.state.state !== 'ready') throw new Error('Host Capability service 未 ready');
    return this.options.capability_service;
  }
  private fault(code: ServiceErrorCode, traceId = '', operationId = ''): grpc.ServiceError {
    const metadata = new grpc.Metadata();
    metadata.set('glimmer-error-bin', Buffer.from(toBinary(ServiceErrorDetailSchema, create(ServiceErrorDetailSchema,
      { code, call: create(CallMetadataSchema, { traceId, generation: this.state.generation ?? '' }), operationId,
        recoveryActions: code === ServiceErrorCode.RECOVERY_REQUIRED ? [ServiceRecoveryAction.CONFIRM_SIDE_EFFECT_STATE] : [] }))));
    return Object.assign(new Error('受监督 Worker control 请求失败'), { code: grpc.status.FAILED_PRECONDITION, details: '受监督 Worker control 请求失败', metadata });
  }
  private zeroSecret(): void { this.secret?.fill(0); this.secret = undefined; this.nonce = undefined; }
  private cancel(): void {
    try { this.options.capability_service?.revokePrincipal(this.principalId()); }
    catch { this.state = { ...this.state, error_code: 'worker_control_failed' }; }
    this.cancellation.abort(new Error('Worker 监督身份已撤销')); this.zeroSecret();
    this.registration?.reject(new Error('Worker 注册等待已撤销'));
    for (const request of this.requests) request.abort();
    for (const client of this.clients) client.close(); this.clients.clear();
  }
  private fail(code: WorkerSupervisorSnapshot['error_code']): void {
    if (this.state.state === 'failed' || this.stoppingRequested) return;
    const wasReady = this.state.state === 'ready';
    this.state = { ...this.state, state: 'failed', error_code: code, endpoint: null };
    this.cancel();
    for (const listener of this.listeners) { try { listener(); } catch { /* 监督回收不依赖观察者成功。 */ } }
    // 启动中由 begin 的 catch 等待 bind/资源创建结束再回收，避免晚到的监听资源泄漏。
    if (wasReady && !this.reclaiming) void this.reclaim().catch(() => undefined);
  }
  private reclaim(): Promise<void> {
    if (this.reclaiming) return this.reclaiming;
    // 先发布 Promise 再操作资源，避免 close/error 回调重入同一回收流程。
    this.reclaiming = Promise.resolve().then(async () => {
      this.cancel();
      const failures: unknown[] = [];
      try {
        if (this.pythonProbe && !this.processSupervisor.isProcessReleased(this.pythonProbe)) {
          await this.processSupervisor.forceTerminateManagedProcessTree(this.pythonProbe, 'Host Python identity probe', 5000, process.platform !== 'win32');
        }
        if (this.pythonProbe && this.processSupervisor.isProcessReleased(this.pythonProbe)) this.pythonProbe = undefined;
      } catch (error) { failures.push(error); }
      try { if (this.child && !this.processSupervisor.isProcessReleased(this.child)) {
        const deadline = Date.now() + this.options.shutdown_timeout_ms;
        if (this.lifecycle) {
          const cancellation = new AbortController();
          const timer = setTimeout(() => cancellation.abort(), this.options.shutdown_timeout_ms);
          try { await this.lifecycle.shutdown('Host supervised shutdown', cancellation.signal); }
          catch { /* 超时后仍核验实际退出；shutdown RPC 与退出等待共用一个预算。 */ }
          finally { clearTimeout(timer); }
        }
        if (!await this.waitExit(Math.max(0, deadline - Date.now()))) {
          this.state = { ...this.state, forced: true };
          await this.processSupervisor.forceTerminateManagedProcessTree(this.child, 'Host Cognition Worker', 5000, process.platform !== 'win32');
        }
      } } catch (error) { failures.push(error); }
      finally {
        // Native owner remains available for retry even if another teardown action fails.
        if (this.child && this.processSupervisor.isProcessReleased(this.child)) this.child = undefined;
        try { this.lifecycle?.close(); this.lifecycle = undefined; } catch (error) { failures.push(error); }
        try { this.server?.forceShutdown(); this.server = undefined; } catch (error) { failures.push(error); }
        this.state = { ...this.state, control_endpoint: null };
        const drained = await bounded(Promise.allSettled([...this.tasks]).then(() => true), this.options.shutdown_timeout_ms);
        if (!drained) failures.push(new Error('Worker control 接收方未响应取消；不能宣称 drain 完成'));
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, 'Host Worker 回收存在错误');
    });
    const reclaiming = this.reclaiming;
    void reclaiming.then(() => { if (this.reclaiming === reclaiming) this.reclaiming = undefined; },
      () => { if (this.reclaiming === reclaiming) this.reclaiming = undefined; });
    return this.reclaiming;
  }
  private async waitExit(timeout: number): Promise<boolean> {
    const child = this.child;
    if (!child || this.processSupervisor.isProcessReleased(child)) return true;
    return await this.processSupervisor.waitForManagedProcessExit(child, timeout) && this.processSupervisor.isProcessReleased(child);
  }

  private async resolvePythonProcess(): Promise<{ command: string; environment: NodeJS.ProcessEnv }> {
    const command = this.options.python_executable;
    if (process.platform !== 'win32') return { command, environment: {} };
    // App policy: resolve the venv redirector to the actual interpreter without weakening PID proof.
    const probe = this.processSupervisor.spawnManagedProcess(command, ['-c', 'import json,sys;print(json.dumps(dict(base=sys._base_executable,executable=sys.executable)))'], {
      cwd: this.options.app_root, windowsHide: true, env: { ...process.env, ...this.options.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    }, this.options.process_tree_bridge, spawn);
    this.pythonProbe = probe;
    const { stdout, code } = await this.processSupervisor.readManagedProcessOutput(probe, 10_000, this.cancellation.signal);
    if (this.processSupervisor.isProcessReleased(probe)) this.pythonProbe = undefined;
    if (code !== 0) throw new Error('Python 解释器身份查询失败');
    const interpreter: unknown = JSON.parse(stdout);
    if (!interpreter || typeof interpreter !== 'object' || !('base' in interpreter) || !('executable' in interpreter)
      || typeof interpreter.base !== 'string' || typeof interpreter.executable !== 'string') throw new Error('Python 解释器身份查询无效');
    if (interpreter.base === interpreter.executable) return { command, environment: {} };
    if (!path.isAbsolute(interpreter.base) || !path.isAbsolute(interpreter.executable) || !existsSync(interpreter.base)) throw new Error('Python 实际解释器路径无效');
    return { command: interpreter.base, environment: { __PYVENV_LAUNCHER__: interpreter.executable } };
  }
  private capture(stream: NodeJS.ReadableStream): void {
    let buffered = '', omitted = false;
    const write = (line: string) => {
      for (const secret of this.secrets) line = line.replaceAll(secret, '[REDACTED]');
      line = line.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
      try { appendFileSync(this.options.console_path, line + '\n', 'utf8'); }
      catch { this.fail('worker_control_failed'); }
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      for (const piece of chunk.split(/(?<=\n)/)) {
        if (!omitted) buffered += piece;
        if (Buffer.byteLength(buffered, 'utf8') > 65536) { buffered = ''; omitted = true; }
        if (piece.endsWith('\n')) { write(omitted ? '[worker console line omitted]' : buffered.trimEnd()); buffered = ''; omitted = false; }
      }
    });
    stream.once('end', () => { if (buffered || omitted) write(omitted ? '[worker console line omitted]' : buffered); });
  }
}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const interrupted = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([promise, interrupted]); } finally { signal.removeEventListener('abort', abort); }
}
async function bounded<T>(promise: Promise<T>, timeout: number): Promise<T | undefined> {
  let timer!: ReturnType<typeof schedule>;
  try { return await Promise.race([promise, new Promise<undefined>(resolve => { timer = schedule(() => resolve(undefined), timeout); })]); }
  finally { unschedule(timer); }
}
