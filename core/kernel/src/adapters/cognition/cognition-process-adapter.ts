import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PerceptionEvent } from '../../ports/application-models';
import type {
  AgentPlanRequest, AgentPlanResponse, AgentSynthesisRequest, AgentSynthesisResponse,
  ConversationHistoryRequest, ConversationHistoryResponse,
  LifeHeartbeatResponse, PerceptionCancelRequest,
  PerceptionOperationHandle, PerceptionOperationResult,
  CognitionProcessTransportPort, CognitionRequestPort, CognitionLifecycleObserver,
} from '../../ports/cognition-service-port';
import { ConfigManager } from '../config/config-manager';
import { CoreException } from '../../domain/errors';
import { createTraceContext } from '../observability/trace-context';
import { getLogger } from '../observability/logger';
import { resolveLogDir, resolveObservabilityDir, resolveRepoRoot, resolveManagedProcessBridge } from '../filesystem/path-utils';
import { ManagedProcessSupervisor } from '@glimmer-cradle/platform';

const logger = getLogger('cognition-manager');
const processSupervisor = new ManagedProcessSupervisor(logger);
const PROCESS_LOG = 'cognition.console.log';
let processLogDir = path.join(resolveLogDir(), 'application');
const execFileAsync = promisify(execFile);

export class CognitionManager {
  private child: ChildProcess | null = null;
  private pythonProbe: ChildProcess | null = null;
  private running = false;
  private ready = false;
  private requestTimeoutMs = 30_000;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private stopping = false;
  private starting = false;
  private recoveryGeneration = 0;
  private recoveryAttempts = 0;
  private readonly inFlightPerceptions = new Map<string, string>();
  private stopOperation: Promise<void> | undefined;

  public constructor(
    private transport: CognitionProcessTransportPort,
    private client: CognitionRequestPort,
    private lifecycleObserver: CognitionLifecycleObserver,
    private readonly memoryJobsOwner: 'legacy' | 'external' = 'legacy',
  ) {
    if (!['legacy', 'external'].includes(memoryJobsOwner)) throw new Error('Memory Jobs owner 无效');
  }

  public async start(): Promise<void> {
    if (this.stopping || this.stopOperation) throw new Error("Cognition 正在关闭");
    if (this.running && this.ready) return;
    if (this.child || this.pythonProbe || this.starting) throw new Error('Cognition 上代进程尚未释放，拒绝并行启动');
    const config = ConfigManager.instance.getConfig();
    const generation = this.recoveryGeneration;
    const secrets = await ConfigManager.instance.loadDashScopeSecretEnvironment();
    const repoRoot = resolveRepoRoot();
    const packagedPython = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME?.trim();
    const command = packagedPython || await ensureDevelopmentPython(repoRoot);
    const args = ['-m', 'glimmer_cradle.cognition_worker', '--memory-jobs-owner', this.memoryJobsOwner];
    this.requestTimeoutMs = config.system.cognition_service.request_timeout_ms;
    if (generation !== this.recoveryGeneration || this.stopOperation || this.child) throw new Error("Cognition 启动世代已关闭或已接纳");
    this.transport.configureActionDeadline(this.requestTimeoutMs);
    processLogDir = path.join(resolveLogDir(), 'application');
    this.stopping = false;
    this.starting = true;
    this.lifecycleObserver('starting', 'Cognition 正在启动并等待本代注册');
    const bootstrap = this.transport.prepareProcess();

    try {
      ConfigManager.instance.freezeCoreConfig();
      const pythonLaunch = await this.resolvePythonProcess(command, repoRoot);
      if (generation !== this.recoveryGeneration || this.stopOperation) throw new Error('Cognition 启动世代已关闭');
      this.child = processSupervisor.spawnManagedProcess(pythonLaunch.command, args, {
        cwd: repoRoot,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          ...pythonLaunch.environment,
          ...secrets,
          GLIMMER_CRADLE_CONFIG: JSON.stringify({
            manifest: config.character.manifest,
            profile: config.character.profile,
            dialogue: config.character.dialogue,
            safety: config.character.safety,
            inference: config.character.inference,
            llm: config.character.llm,
            memory: config.system.memory,
            embedding: config.system.embedding,
            cognition: config.system.cognition,
          }),
          GLIMMER_CRADLE_OBSERVABILITY: JSON.stringify(config.system.observability),
          GLIMMER_CRADLE_OBSERVABILITY_DIR: resolveObservabilityDir(),
          LOG_DIR: resolveLogDir(),
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      }, resolveManagedProcessBridge(), spawn);
      this.attachProcessObservers(this.child);
      if (!this.child.pid) throw new Error('Cognition 子进程未返回 PID');
      const child = this.child;
      const processId = await processSupervisor.waitForManagedProcessReady(child, config.system.cognition_service.registration_timeout_ms);
      if (this.child !== child || generation !== this.recoveryGeneration || this.stopOperation || !processSupervisor.isManagedProcessRootRunning(child)) throw new Error('Cognition 启动世代或实际根已失效');
      this.transport.expectProcess(processId);
      const bootstrapPipe = child.stdio[3];
      if (!bootstrapPipe || typeof (bootstrapPipe as NodeJS.WritableStream).write !== 'function') {
        throw new Error('Cognition 子进程缺少受监督 bootstrap pipe');
      }
      (bootstrapPipe as NodeJS.WritableStream).end(`${JSON.stringify(bootstrap)}\n`);
      this.running = true;

      logger.info('Cognition 认知核启动：等待 gRPC 注册与真实 readiness');
      await this.transport.waitForRegistration(config.system.cognition_service.registration_timeout_ms);
      await this.client.initializeKnowledge(await ConfigManager.instance.loadKnowledgeBaseConfig(), this.requestTimeoutMs);
      const readiness = await this.waitForBusinessReadiness(bootstrap.generation, this.requestTimeoutMs);
      this.ready = true;
      this.starting = false;
      this.lifecycleObserver('ready', 'Cognition 已完成本代注册、初始化与 readiness');
      logger.info('Cognition 认知核已就绪', { startup_stage: readiness.phase });
    } catch (error) {
      this.starting = false;
      logger.error('Cognition 认知核启动失败', { error: normalizeError(error) });
      await this.stop();
      this.lifecycleObserver('failed', 'Cognition 启动失败，必需入站保持关闭');
      throw error;
    }
  }

  public async sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<PerceptionOperationHandle> {
    this.assertReady();
    const resolvedTraceId = traceId ?? createTraceContext().trace_id;
    const operation = await this.client.submitPerception(request, resolvedTraceId, this.requestTimeoutMs);
    if (!operation.terminal) this.inFlightPerceptions.set(resolvedTraceId, operation.operation_id);
    const completion = operation.terminal
      ? Promise.resolve(operation)
      : this.observePerceptionTerminal(resolvedTraceId, operation.operation_id);
    return { ...operation, trace_id: resolvedTraceId, completion };
  }

  private async waitForBusinessReadiness(generation: string, timeoutMs: number): Promise<{ readonly phase: string }> {
    const deadline = Date.now() + timeoutMs;
    while (this.running && !this.stopping) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const readiness = await this.client.readiness(remaining);
      if (!this.running || this.stopping || readiness.generation !== generation) {
        throw new CoreException('Cognition readiness 世代或生命周期已失效', 'INFERENCE_ERROR');
      }
      if (readiness.state === 'ready') return readiness;
      if (readiness.state !== 'starting') {
        throw new CoreException('Cognition 未达到本代业务 ready', 'INFERENCE_ERROR');
      }
      // 注册 ACK 不代表首条状态投影已完成；只在同一 deadline 内等待 starting。
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    }
    throw new CoreException('Cognition 等待业务 ready 超时或已停止', 'INFERENCE_ERROR');
  }

  public async cancelPerception(request: PerceptionCancelRequest): Promise<void> {
    if (!this.isReady) return;
    let operation = await this.client.cancelPerception(request, this.requestTimeoutMs);
    const deadline = Date.now() + this.requestTimeoutMs;
    while (!operation.terminal && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      operation = await this.client.perceptionOperation(operation.operation_id, Math.max(1, deadline - Date.now()));
    }
    if (!operation.terminal) throw new CoreException('感知取消未在 deadline 前到达终态', 'INFERENCE_ERROR');
    this.inFlightPerceptions.delete(request.target_trace_id);
  }

  public async sendAgentPlan(request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse> {
    this.assertReady();
    return this.client.plan(request, traceId ?? createTraceContext().trace_id, this.requestTimeoutMs);
  }

  public async sendAgentSynthesis(request: AgentSynthesisRequest, signal?: AbortSignal): Promise<AgentSynthesisResponse> {
    this.assertReady();
    return this.client.synthesize(request, this.requestTimeoutMs, signal);
  }

  public async sendLifeHeartbeat(_request: Record<string, never>): Promise<LifeHeartbeatResponse> {
    this.assertReady();
    return this.client.heartbeat(this.requestTimeoutMs);
  }

  public async getConversationHistory(request: ConversationHistoryRequest, traceId?: string): Promise<ConversationHistoryResponse> {
    this.assertReady();
    return this.client.conversationHistory(request, traceId ?? createTraceContext().trace_id, this.requestTimeoutMs);
  }

  public async restart(): Promise<void> {
    await this.stop();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this.start();
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
    this.recoveryGeneration += 1;
    const child = this.child;
    this.stopping = true;
    this.ready = false;
    try {
      if (this.pythonProbe && !processSupervisor.isProcessReleased(this.pythonProbe)) {
        await processSupervisor.forceTerminateManagedProcessTree(this.pythonProbe, 'Cognition Python identity probe', 1000, process.platform !== 'win32');
      }
      if (this.pythonProbe && processSupervisor.isProcessReleased(this.pythonProbe)) this.pythonProbe = null;
    } catch (error) {
      this.stopping = false;
      this.lifecycleObserver('failed', 'Cognition 身份探测回收未确认，保留 owner 等待恢复');
      throw error;
    }
    if (!this.running && !child) {
      try {
        await this.transport.invalidateProcess(undefined, new Error('Cognition 生命周期已停止'));
      } finally {
        this.inFlightPerceptions.clear();
        this.stopping = false;
      }
      return;
    }
    if (child && !child.pid) {
      try {
        await this.transport.invalidateProcess(undefined, new Error('Cognition 子进程未取得 PID'));
      } finally {
        this.child = null;
        this.running = false;
        this.inFlightPerceptions.clear();
        this.stopping = false;
      }
      this.lifecycleObserver('stopped', 'Cognition 未完成启动的子进程已释放');
      return;
    }
    let processStopped = false;
    try {
      let accepted = false;
      if (child && this.transport.isRegistered) {
        try {
          await this.client.shutdown('kernel_lifecycle_stop', 1000);
          accepted = true;
        } catch (error) {
          logger.warn('Cognition gRPC 停机请求失败，转入受管进程回收', { error: normalizeError(error) });
        }
      }
      if (child && accepted) {
        if (!await processSupervisor.waitForManagedProcessExit(child, 2500) || !processSupervisor.isProcessReleased(child)) {
          await processSupervisor.forceTerminateManagedProcessTree(child, 'Cognition 认知核', 1000, process.platform !== 'win32');
        }
      } else {
        await processSupervisor.stopManagedProcess(child, {
          label: 'Cognition 认知核', gracefulTimeoutMs: 2500, forceTimeoutMs: 1000,
          ownsProcessGroup: process.platform !== 'win32',
        });
      }
      processStopped = true;
    } catch (error) {
      this.lifecycleObserver('failed', 'Cognition 进程回收未确认，保留 owner 等待恢复');
      throw error;
    } finally {
      try {
        await this.transport.invalidateProcess(
          child ? processSupervisor.managedProcessPid(child) : undefined,
          new Error('Cognition 受监督进程生命周期已结束'),
        );
      } finally {
        this.running = false;
        this.inFlightPerceptions.clear();
        if (processStopped || child && processSupervisor.isProcessReleased(child)) this.child = null;
        this.stopping = false;
      }
    }
    logger.info('Cognition 认知核停止完成');
    this.lifecycleObserver('stopped', 'Cognition 已停止');
  }

  public get isReady(): boolean {
    return this.ready && this.running && this.transport.isRegistered;
  }

  private assertReady(): void {
    if (!this.isReady) throw new CoreException('Cognition 认知核未就绪', 'INFERENCE_ERROR');
  }

  private reconfigure(
    transport: CognitionProcessTransportPort,
    client: CognitionRequestPort,
    observer: CognitionLifecycleObserver,
  ): void {
    if (this.running || this.starting || this.child || this.pythonProbe) {
      if (this.transport !== transport || this.client !== client) {
        throw new Error('CognitionManager 运行期间不得替换 transport composition');
      }
      this.lifecycleObserver = observer;
      return;
    }
    this.transport = transport;
    this.client = client;
    this.lifecycleObserver = observer;
  }

  private async observePerceptionTerminal(traceId: string, operationId: string): Promise<PerceptionOperationResult> {
    while (this.inFlightPerceptions.get(traceId) === operationId && this.isReady) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        const operation = await this.client.perceptionOperation(
          operationId,
          Math.min(this.requestTimeoutMs, 5_000),
        );
        if (operation.terminal) {
          if (this.inFlightPerceptions.get(traceId) === operationId) {
            this.inFlightPerceptions.delete(traceId);
          }
          return operation;
        }
      } catch (error) {
        if (!this.isReady) throw new CoreException('Cognition 在感知操作到达终态前失去就绪状态', 'INFERENCE_ERROR');
        logger.warn('查询 Cognition 感知操作终态失败，将继续受管轮询', {
          operation_id: operationId,
          error: normalizeError(error),
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new CoreException('感知操作在到达终态前失去受管所有权', 'INFERENCE_ERROR');
  }

  private attachProcessObservers(child: ChildProcess): void {
    child.stdout?.on('data', (data: Buffer) => this.consumeOutput(data, false));
    child.stderr?.on('data', (data: Buffer) => this.consumeOutput(data, true));
    let rootObserved = false;
    let rootRecovery: Promise<void> | undefined;
    const onRootExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (rootObserved || this.child !== child) return;
      rootObserved = true;
      this.flushOutput();
      const interrupted = code === 0xC000013A;
      const intentional = this.stopping || interrupted;
      const startupFailure = this.starting;
      const released = processSupervisor.isProcessReleased(child);
      if (this.child === child && released) this.child = null;
      this.running = false;
      this.ready = false;
      const invalidation = this.transport.invalidateProcess(
        processSupervisor.managedProcessPid(child),
        new Error('受监督 Cognition 进程退出'),
      );
      void invalidation.catch((error) => {
        logger.error('Cognition 退出后的 transport 失效失败', { error: normalizeError(error) });
      });
      logger[code === 0 || interrupted ? 'info' : 'warn']('Cognition 认知核进程退出', { code, signal });
      if (!intentional) {
        this.inFlightPerceptions.clear();
        this.lifecycleObserver('failed', 'Cognition 受监督进程意外退出');
      }
      if (!intentional && !startupFailure && released) {
        const recoveryGeneration = ++this.recoveryGeneration;
        void this.recoverAfterUnexpectedExit(invalidation, recoveryGeneration);
      }
      if (!intentional && !startupFailure && !released) rootRecovery = invalidation;
    };
    processSupervisor.onManagedProcessRootExit(child, onRootExit);
    processSupervisor.onManagedProcessExit(child, () => {
      if (this.child !== child) return;
      if (!rootObserved) onRootExit(child.exitCode, child.signalCode);
      if (!processSupervisor.isProcessReleased(child)) return;
      this.child = null;
      if (rootRecovery && !this.stopping && !this.starting) {
        const generation = ++this.recoveryGeneration;
        void this.recoverAfterUnexpectedExit(rootRecovery, generation);
      }
    });
    child.on('error', (error: any) => {
      // A pipe/signal error does not prove that a successfully spawned process exited.
      if (this.child === child && (!child.pid || processSupervisor.isProcessReleased(child))) this.child = null;
      this.running = false;
      this.ready = false;
      this.lifecycleObserver('failed', 'Cognition 子进程启动失败');
      logger.error('Cognition 子进程启动失败', { error: error.message });
      void this.transport.invalidateProcess(processSupervisor.managedProcessPid(child), error).catch((invalidationError) => {
        logger.error('Cognition 子进程错误后的 transport 失效失败', {
          error: normalizeError(invalidationError),
        });
      });
    });
  }

  private async recoverAfterUnexpectedExit(
    invalidation: Promise<void>,
    recoveryGeneration: number,
  ): Promise<void> {
    try {
      await invalidation;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (
        recoveryGeneration === this.recoveryGeneration
        && !this.stopping
        && !this.running
        && !this.starting
      ) {
        this.recoveryAttempts += 1;
        await this.start();
      }
    } catch (error) {
      this.lifecycleObserver('failed', 'Cognition 自动恢复失败，必需入站保持关闭');
      logger.error('Cognition 自动重启失败', { error: normalizeError(error) });
    }
  }

  private consumeOutput(data: Buffer, stderr: boolean): void {
    const key = stderr ? 'stderrBuffer' : 'stdoutBuffer';
    this[key] += data.toString('utf8');
    const lines = this[key].split('\n');
    this[key] = lines.pop() ?? '';
    for (const line of lines) routeProcessLine(line, stderr);
  }

  private async resolvePythonProcess(command: string, repoRoot: string): Promise<{ command: string; environment: NodeJS.ProcessEnv }> {
    if (process.platform !== 'win32') return { command, environment: {} };
    // The venv redirector and Python startup hooks may create descendants; the probe has its own Job.
    const probe = processSupervisor.spawnManagedProcess(command, ['-c', 'import json,sys;print(json.dumps(dict(base=sys._base_executable,executable=sys.executable)))'], {
      cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }, resolveManagedProcessBridge(), spawn);
    this.pythonProbe = probe;
    const { stdout, code } = await processSupervisor.readManagedProcessOutput(probe, 10_000);
    if (processSupervisor.isProcessReleased(probe)) this.pythonProbe = null;
    if (code !== 0) throw new Error('Python 解释器身份查询失败');
    const interpreter: unknown = JSON.parse(stdout);
    if (!interpreter || typeof interpreter !== 'object' || !('base' in interpreter) || !('executable' in interpreter)
      || typeof interpreter.base !== 'string' || typeof interpreter.executable !== 'string') throw new Error('Python 解释器身份查询无效');
    if (interpreter.base === interpreter.executable) return { command, environment: {} };
    if (!path.isAbsolute(interpreter.base) || !path.isAbsolute(interpreter.executable) || !await fs.pathExists(interpreter.base)) throw new Error('Python 实际解释器路径无效');
    return { command: interpreter.base, environment: { __PYVENV_LAUNCHER__: interpreter.executable } };
  }

  private flushOutput(): void {
    if (this.stdoutBuffer.trim()) routeProcessLine(this.stdoutBuffer, false);
    if (this.stderrBuffer.trim()) routeProcessLine(this.stderrBuffer, true);
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }
}

function routeProcessLine(line: string, stderr: boolean): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: Record<string, unknown> | undefined;
  try { parsed = JSON.parse(trimmed) as Record<string, unknown>; } catch { parsed = undefined; }
  const level = String(parsed?.level ?? (stderr ? 'warn' : 'debug')).toLowerCase();
  const event = String(parsed?.event ?? trimmed);
  const record = { timestamp: String(parsed?.timestamp ?? new Date().toISOString()), level, source: 'cognition', stream: stderr ? 'stderr' : 'stdout', message: event, ...(parsed ?? {}) };
  fs.ensureDir(processLogDir)
    .then(() => fs.appendFile(path.join(processLogDir, PROCESS_LOG), `${JSON.stringify(record)}\n`, 'utf8'))
    .catch((error: any) => console.error('写入 Cognition 子进程日志失败', error));
  if (level === 'error' || level === 'critical') logger.error('Cognition 子进程错误', { child_event: event, trace_id: parsed?.trace_id });
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureDevelopmentPython(repoRoot: string): Promise<string> {
  const python = process.platform === 'win32'
    ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(repoRoot, '.venv', 'bin', 'python');
  const uv = process.platform === 'win32' ? 'uv.exe' : 'uv';
  // 根环境也供 Audio 使用；安装 Worker 时保留已安装的语音 extras。
  await execFileAsync(uv, [
    'sync', '--project', path.join(repoRoot, 'apps', 'cognition-worker'), '--frozen', '--inexact',
  ], { cwd: repoRoot, windowsHide: true });
  if (!await fs.pathExists(python)) {
    throw new Error('Cognition Python 环境准备完成后仍缺少受监督解释器');
  }
  return python;
}
