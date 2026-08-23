import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'fs-extra';
import type { PerceptionEvent } from '@glimmer-cradle/protocol';
import type {
  AgentPlanRequest, AgentPlanResponse, AgentSynthesisRequest, AgentSynthesisResponse,
  ConversationHistoryRequest, ConversationHistoryResponse,
  LifeHeartbeatResponse, PerceptionCancelRequest,
  PerceptionOperationHandle, PerceptionOperationResult,
  CognitionProcessTransportPort, CognitionRequestPort, CognitionLifecycleObserver,
} from '../../../foundation/ports/cognition-service-port';
import { ConfigManager } from '../../../foundation/config/config-manager';
import { CoreException } from '../../../foundation/exceptions';
import { createTraceContext } from '../../../foundation/logger/trace-context';
import { getLogger } from '../../../foundation/logger/logger';
import { resolveLogDir, resolveObservabilityDir, resolveRepoRoot } from '../../../foundation/utils/path-utils';
import { forceTerminateManagedProcessTree, stopManagedProcess, waitForManagedProcessExit } from '../../../foundation/process/process-supervisor';

const logger = getLogger('cognition-manager');
const PROCESS_LOG = 'cognition.console.log';
let processLogDir = path.join(resolveLogDir(), 'application');
const execFileAsync = promisify(execFile);

export class CognitionManager {
  private static singleton: CognitionManager | null = null;
  private child: ChildProcess | null = null;
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

  public static configure(
    transport: CognitionProcessTransportPort,
    client: CognitionRequestPort,
    observer: CognitionLifecycleObserver,
  ): CognitionManager {
    if (!CognitionManager.singleton) {
      CognitionManager.singleton = new CognitionManager(transport, client, observer);
    } else {
      CognitionManager.singleton.reconfigure(transport, client, observer);
    }
    return CognitionManager.singleton;
  }

  public static get instance(): CognitionManager {
    if (!CognitionManager.singleton) throw new Error('CognitionManager 尚未由生命周期组装根配置');
    return CognitionManager.singleton;
  }

  private constructor(
    private transport: CognitionProcessTransportPort,
    private client: CognitionRequestPort,
    private lifecycleObserver: CognitionLifecycleObserver,
  ) {}

  public async start(): Promise<void> {
    if (this.running) return;
    const config = ConfigManager.instance.getConfig();
    const secrets = await ConfigManager.instance.loadDashScopeSecretEnvironment();
    const repoRoot = resolveRepoRoot();
    const cognitionDir = path.resolve(repoRoot, 'core', 'cognition');
    const packagedPython = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME?.trim();
    const command = packagedPython || await ensureDevelopmentPython(cognitionDir);
    const args = ['-m', 'glimmer_cradle.cognition.host.process'];
    this.requestTimeoutMs = config.system.cognition_service.request_timeout_ms;
    this.transport.configureActionDeadline(this.requestTimeoutMs);
    processLogDir = path.join(resolveLogDir(), 'application');
    this.stopping = false;
    this.starting = true;
    this.lifecycleObserver('starting', 'Cognition 正在启动并等待本代注册');
    const bootstrap = this.transport.prepareProcess();

    try {
      ConfigManager.instance.freezeCoreConfig();
      this.child = spawn(command, args, {
        cwd: repoRoot,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          ...secrets,
          GLIMMER_CRADLE_CONFIG: JSON.stringify({
            ...config.character,
            memory: config.system.memory,
            embedding: config.system.embedding,
          }),
          GLIMMER_CRADLE_OBSERVABILITY: JSON.stringify(config.system.observability),
          GLIMMER_CRADLE_OBSERVABILITY_DIR: resolveObservabilityDir(),
          LOG_DIR: resolveLogDir(),
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      });
      this.attachProcessObservers(this.child);
      if (!this.child.pid) throw new Error('Cognition 子进程未返回 PID');
      this.transport.expectProcess(this.child.pid);
      const bootstrapPipe = this.child.stdio[3];
      if (!bootstrapPipe || typeof (bootstrapPipe as NodeJS.WritableStream).write !== 'function') {
        throw new Error('Cognition 子进程缺少受监督 bootstrap pipe');
      }
      (bootstrapPipe as NodeJS.WritableStream).end(`${JSON.stringify(bootstrap)}\n`);
      this.running = true;

      logger.info('Cognition 认知核启动：等待 gRPC 注册与真实 readiness');
      await this.transport.waitForRegistration(config.system.cognition_service.registration_timeout_ms);
      await this.client.initializeKnowledge(await ConfigManager.instance.loadKnowledgeBaseConfig(), this.requestTimeoutMs);
      const readiness = await this.client.readiness(this.requestTimeoutMs);
      if (readiness.state !== 'ready' || readiness.generation !== bootstrap.generation) {
        throw new CoreException('Cognition 未达到本代业务 ready', 'INFERENCE_ERROR');
      }
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

  public async stop(): Promise<void> {
    this.recoveryGeneration += 1;
    const child = this.child;
    this.stopping = true;
    this.ready = false;
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
        if (!await waitForManagedProcessExit(child, 2500)) {
          await forceTerminateManagedProcessTree(child, 'Cognition 认知核', 1000, process.platform !== 'win32');
        }
      } else {
        await stopManagedProcess(child, {
          label: 'Cognition 认知核', gracefulTimeoutMs: 2500, forceTimeoutMs: 1000,
          ownsProcessGroup: process.platform !== 'win32',
        });
      }
    } finally {
      try {
        await this.transport.invalidateProcess(
          child?.pid,
          new Error('Cognition 受监督进程生命周期已结束'),
        );
      } finally {
        this.running = false;
        this.inFlightPerceptions.clear();
        this.child = null;
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
    if (this.running || this.starting || this.child) {
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
    child.on('exit', (code, signal) => {
      this.flushOutput();
      const interrupted = code === 0xC000013A;
      const intentional = this.stopping || interrupted;
      const startupFailure = this.starting;
      if (this.child === child) this.child = null;
      this.running = false;
      this.ready = false;
      const invalidation = this.transport.invalidateProcess(
        child.pid,
        new Error('受监督 Cognition 进程退出'),
      );
      logger[code === 0 || interrupted ? 'info' : 'warn']('Cognition 认知核进程退出', { code, signal });
      if (!intentional) {
        this.inFlightPerceptions.clear();
        this.lifecycleObserver('failed', 'Cognition 受监督进程意外退出');
      }
      if (!intentional && !startupFailure) {
        const recoveryGeneration = ++this.recoveryGeneration;
        void this.recoverAfterUnexpectedExit(invalidation, recoveryGeneration);
      }
    });
    child.on('error', (error) => {
      if (this.child === child) this.child = null;
      this.running = false;
      this.ready = false;
      this.lifecycleObserver('failed', 'Cognition 子进程启动失败');
      logger.error('Cognition 子进程启动失败', { error: error.message });
      void this.transport.invalidateProcess(child.pid, error).catch((invalidationError) => {
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
    .catch((error) => console.error('写入 Cognition 子进程日志失败', error));
  if (level === 'error' || level === 'critical') logger.error('Cognition 子进程错误', { child_event: event, trace_id: parsed?.trace_id });
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureDevelopmentPython(cognitionDir: string): Promise<string> {
  const python = process.platform === 'win32'
    ? path.join(cognitionDir, '.venv', 'Scripts', 'python.exe')
    : path.join(cognitionDir, '.venv', 'bin', 'python');
  if (!await fs.pathExists(python)) {
    const uv = process.platform === 'win32' ? 'uv.exe' : 'uv';
    await execFileAsync(uv, ['sync', '--project', cognitionDir, '--frozen'], {
      cwd: resolveRepoRoot(),
      windowsHide: true,
    });
  }
  if (!await fs.pathExists(python)) {
    throw new Error('Cognition Python 环境准备完成后仍缺少受监督解释器');
  }
  return python;
}
