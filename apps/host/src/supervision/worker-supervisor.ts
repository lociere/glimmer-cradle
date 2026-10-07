import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as schedule, clearTimeout as unschedule } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type Message } from '@bufbuild/protobuf';
import { CallMetadataSchema, ServiceErrorCode, ServiceErrorDetailSchema } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { KernelControlService, RegisterCognitionResponseSchema,
  type RegisterCognitionRequest, type PublishStateRequest, type PublishStateResponse,
  type PublishLogRequest, type PublishLogResponse, type PublishActionRequest, type PublishActionResponse,
} from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import { CognitionClient } from '../adapters/protocol/cognition-client.js';

export interface WorkerSupervisorOptions {
  readonly python_executable: string;
  readonly app_root: string;
  readonly data_root: string;
  readonly console_path: string;
  readonly runtime_document: Readonly<Record<string, unknown>>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly startup_timeout_ms: number;
  readonly shutdown_timeout_ms: number;
  readonly request_timeout_ms: number;
  /** 接收方拥有投影与幂等性；缺少真实接收不能伪造首条状态已完成。 */
  readonly accept_state: (request: PublishStateRequest, signal: AbortSignal) => Promise<PublishStateResponse>;
  readonly accept_log?: (request: PublishLogRequest, signal: AbortSignal) => Promise<PublishLogResponse>;
  readonly accept_action?: (request: PublishActionRequest, signal: AbortSignal) => Promise<PublishActionResponse>;
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
  private registeredProcessId?: number;
  private lifecycle?: CognitionClient;
  private secret?: Buffer;
  private nonce?: string;
  private firstState = false;
  private registration?: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
  private starting?: Promise<WorkerSession>;
  private stopping?: Promise<void>;
  private reclaiming?: Promise<void>;
  private terminal?: Promise<void>;
  private closed = false;
  private stoppingRequested = false;

  public constructor(options: WorkerSupervisorOptions) {
    if (![options.python_executable, options.app_root, options.data_root, options.console_path]
      .every(value => typeof value === 'string' && path.isAbsolute(value))
      || ![options.startup_timeout_ms, options.shutdown_timeout_ms, options.request_timeout_ms]
        .every(value => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647)
      || options.request_timeout_ms > options.startup_timeout_ms || typeof options.accept_state !== 'function'
      || !options.runtime_document || typeof options.runtime_document !== 'object' || Array.isArray(options.runtime_document)) {
      throw new Error('Worker supervisor 装配参数无效');
    }
    this.options = { ...options, environment: { ...options.environment } };
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
  public createJobsClient(): CognitionClient {
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
    this.cancel();
    this.stopping = (async () => {
      await this.starting?.catch(() => undefined);
      try {
        await this.reclaim();
        this.state = { ...this.state, state: 'stopped', endpoint: null };
      } catch (error) {
        this.state = { ...this.state, state: 'failed', error_code: 'worker_control_failed', endpoint: null };
        throw error;
      }
    })();
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
      const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
        (error, value) => error ? reject(error) : resolve(value)));
      this.cancellation.signal.throwIfAborted();
      this.state = { ...this.state, control_endpoint: `grpc://127.0.0.1:${port}` };
      mkdirSync(path.dirname(this.options.console_path), { recursive: true });
      const child = spawn(this.options.python_executable, ['-m', 'glimmer_cradle.cognition_worker', '--memory-jobs-owner', 'external'], {
        cwd: this.options.app_root, detached: process.platform !== 'win32', windowsHide: true,
        env: { ...process.env, ...this.options.environment, GLIMMER_CRADLE_APP_ROOT: this.options.app_root,
          GLIMMER_CRADLE_DATA_ROOT: this.options.data_root, GLIMMER_CRADLE_CONFIG: this.document, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      });
      this.child = child; this.state = { ...this.state, process_id: child.pid ?? null };
      this.capture(child.stdout!); this.capture(child.stderr!);
      this.terminal = new Promise(resolve => child.once('close', code => {
        this.closed = true; this.state = { ...this.state, exit_code: code }; resolve();
        if (!this.stoppingRequested && !this.reclaiming) this.fail('worker_exited');
      }));
      child.once('exit', () => {
        if (!this.stoppingRequested && !this.reclaiming) this.fail('worker_exited');
      });
      child.once('error', () => this.fail('worker_start_failed'));
      if (!child.pid) throw new Error('Worker 未返回受监督 PID');
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
    // Windows venv redirector 可转交给一个直接子进程；两种形式均须持有 FD3 一次性能力。
    if (![pid, parent].every(value => Number.isSafeInteger(value) && value > 0)
      || !(pid === this.child?.pid && parent === process.pid || parent === this.child?.pid)
      || !/^grpc:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(request.endpoint)
      || Number(request.endpoint.split(':').at(-1)) > 65535) throw new Error('受监督进程/端点不匹配');
    const expected = createHmac('sha256', this.secret).update(`${this.state.generation}\n${this.nonce}\n${request.endpoint}\n${pid}\n${parent}`).digest();
    const proof = Buffer.from(request.authProof);
    if (proof.length !== expected.length || !timingSafeEqual(proof, expected)) throw new Error('注册认证失败');
    this.zeroSecret(); this.state = { ...this.state, endpoint: request.endpoint };
    this.registeredProcessId = pid;
    this.lifecycle = new CognitionClient(request.endpoint, this.state.generation!, this.options.request_timeout_ms);
    this.registration!.resolve();
    return create(RegisterCognitionResponseSchema, { generation: this.state.generation!, accepted: true });
  }
  private receive<I extends { call?: { generation: string; traceId: string } }, O>(call: grpc.ServerUnaryCall<I, O>,
    callback: grpc.sendUnaryData<O>, handler: (signal: AbortSignal) => Promise<O>): void {
    const cancellation = new AbortController(); this.requests.add(cancellation);
    const timer = setTimeout(() => cancellation.abort(), this.options.request_timeout_ms);
    cancellation.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    call.once('cancelled', () => cancellation.abort());
    const task = (async () => {
      try {
        this.assertCurrent(call.request.call?.generation);
        if (!call.request.call?.traceId) throw new Error('缺少 trace');
        const result = await handler(cancellation.signal);
        cancellation.signal.throwIfAborted();
        this.assertCurrent(call.request.call?.generation);
        callback(null, result);
      } catch {
        const code = call.request.call?.generation !== this.state.generation ? ServiceErrorCode.GENERATION_MISMATCH
          : cancellation.signal.aborted ? ServiceErrorCode.CANCELLED : ServiceErrorCode.NOT_READY;
        callback(this.fault(code, call.request.call?.traceId), null);
      } finally { clearTimeout(timer); this.requests.delete(cancellation); }
    })();
    this.tasks.add(task); void task.finally(() => this.tasks.delete(task)).catch(() => this.fail('worker_control_failed'));
  }
  private assertCurrent(generation?: string): void {
    if (!this.state.endpoint || generation !== this.state.generation || this.cancellation.signal.aborted) throw new Error('Worker 调用世代已撤销');
  }
  private fault(code: ServiceErrorCode, traceId = ''): grpc.ServiceError {
    const metadata = new grpc.Metadata();
    metadata.set('glimmer-error-bin', Buffer.from(toBinary(ServiceErrorDetailSchema, create(ServiceErrorDetailSchema,
      { code, call: create(CallMetadataSchema, { traceId, generation: this.state.generation ?? '' }) }))));
    return Object.assign(new Error('受监督 Worker control 请求失败'), { code: grpc.status.FAILED_PRECONDITION, details: '受监督 Worker control 请求失败', metadata });
  }
  private zeroSecret(): void { this.secret?.fill(0); this.secret = undefined; this.nonce = undefined; }
  private cancel(): void {
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
      try { if (this.child && !this.closed) {
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
          const pid = this.child.pid;
          if (pid) {
            if (process.platform === 'win32') {
              // redirector 已退出时仍回收通过本代能力认证的直接子进程，不枚举任意系统 PID。
              const owned = new Set([...(this.child.exitCode === null && this.child.signalCode === null ? [pid] : []),
                ...(this.registeredProcessId ? [this.registeredProcessId] : [])]);
              for (const target of owned) await new Promise<void>(resolve => execFile('taskkill', ['/PID', String(target), '/T', '/F'],
                { windowsHide: true, timeout: 5000 }, () => resolve()));
            } else { try { process.kill(-pid, 'SIGKILL'); } catch { /* 退出竞态仍以 terminal 证据判断。 */ } }
          }
          if (!await this.waitExit(5000)) throw new Error('受监督 Worker 进程树未完成回收');
        }
      } } finally {
        this.lifecycle?.close(); this.lifecycle = undefined;
        this.server?.forceShutdown(); this.server = undefined;
        this.state = { ...this.state, control_endpoint: null };
        const drained = await bounded(Promise.allSettled([...this.tasks]).then(() => true), this.options.shutdown_timeout_ms);
        if (!drained) throw new Error('Worker control 接收方未响应取消；不能宣称 drain 完成');
      }
    });
    return this.reclaiming;
  }
  private async waitExit(timeout: number): Promise<boolean> {
    return this.closed || !this.terminal ? true : !!await bounded(this.terminal.then(() => true), timeout);
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
