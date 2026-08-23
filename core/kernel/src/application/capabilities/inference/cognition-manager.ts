import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'fs-extra';
import type { PerceptionEvent } from '@glimmer-cradle/protocol';
import type {
  AgentPlanRequest, AgentPlanResponse, AgentSynthesisRequest, AgentSynthesisResponse,
  ChatMessageResponse, ConversationHistoryRequest, ConversationHistoryResponse,
  LifeHeartbeatResponse, PerceptionCancelRequest,
} from '../../../foundation/ports/cognition-service-port';
import { ServiceErrorCode } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { CognitionClient } from '../../../adapters/cognition/cognition-client';
import { CognitionTransportError, KernelCognitionTransport } from '../../../adapters/cognition/kernel-cognition-transport';
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
  private readonly transport = KernelCognitionTransport.instance;
  private readonly client = new CognitionClient(this.transport);
  private child: ChildProcess | null = null;
  private running = false;
  private ready = false;
  private requestTimeoutMs = 30_000;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private stopping = false;
  private starting = false;

  public static get instance(): CognitionManager {
    CognitionManager.singleton ??= new CognitionManager();
    return CognitionManager.singleton;
  }

  private constructor() {}

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
    processLogDir = path.join(resolveLogDir(), 'application');
    this.stopping = false;
    this.starting = true;
    const generation = this.transport.prepareProcess();

    try {
      ConfigManager.instance.freezeCoreConfig();
      this.child = spawn(command, args, {
        cwd: repoRoot,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          ...secrets,
          GLIMMER_CRADLE_KERNEL_GRPC_ENDPOINT: this.transport.controlEndpoint,
          GLIMMER_CRADLE_COGNITION_GENERATION: generation,
          GLIMMER_CRADLE_CONFIG: JSON.stringify({
            ...config.character,
            memory: config.system.memory,
            embedding: config.system.embedding,
          }),
          GLIMMER_CRADLE_OBSERVABILITY: JSON.stringify(config.system.observability),
          GLIMMER_CRADLE_OBSERVABILITY_DIR: resolveObservabilityDir(),
          LOG_DIR: resolveLogDir(),
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: [
            path.resolve(repoRoot, 'contracts', 'generated', 'python'),
            path.resolve(repoRoot, 'core', 'cognition', 'src'),
            process.env.PYTHONPATH,
          ].filter(Boolean).join(path.delimiter),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!this.child.pid) throw new Error('Cognition 子进程未返回 PID');
      this.transport.expectProcess(this.child.pid);
      this.attachProcessObservers(this.child);
      this.running = true;

      logger.info('Cognition 认知核启动：等待 gRPC 注册与真实 readiness');
      await this.transport.waitForRegistration(config.system.cognition_service.registration_timeout_ms);
      await this.client.initializeKnowledge(await ConfigManager.instance.loadKnowledgeBaseConfig(), this.requestTimeoutMs);
      const readiness = await this.client.readiness(this.requestTimeoutMs);
      if (readiness.state !== 'ready' || readiness.generation !== generation) {
        throw new CognitionTransportError('Cognition 未达到本代业务 ready', ServiceErrorCode.NOT_READY, true);
      }
      this.ready = true;
      this.starting = false;
      logger.info('Cognition 认知核已就绪', { startup_stage: readiness.phase });
    } catch (error) {
      this.starting = false;
      logger.error('Cognition 认知核启动失败', { error: normalizeError(error) });
      await this.stop();
      throw error;
    }
  }

  public async sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<ChatMessageResponse> {
    this.assertReady();
    await this.client.submitPerception(request, traceId ?? createTraceContext().trace_id, this.requestTimeoutMs);
    return {} as ChatMessageResponse;
  }

  public async cancelPerception(request: PerceptionCancelRequest): Promise<void> {
    if (this.isReady) await this.client.cancelPerception(request, this.requestTimeoutMs);
  }

  public async sendAgentPlan(request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse> {
    this.assertReady();
    return this.client.plan(request, traceId ?? createTraceContext().trace_id, this.requestTimeoutMs);
  }

  public async sendAgentSynthesis(request: AgentSynthesisRequest): Promise<AgentSynthesisResponse> {
    this.assertReady();
    return this.client.synthesize(request, this.requestTimeoutMs);
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
    const child = this.child;
    if (!this.running && !child) return;
    this.stopping = true;
    this.ready = false;
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
    if (child?.pid) await this.transport.invalidateProcess(child.pid);
    this.running = false;
    this.child = null;
    this.stopping = false;
    logger.info('Cognition 认知核停止完成');
  }

  public get isReady(): boolean {
    return this.ready && this.running && this.transport.isRegistered;
  }

  private assertReady(): void {
    if (!this.isReady) throw new CoreException('Cognition 认知核未就绪', 'INFERENCE_ERROR');
  }

  private attachProcessObservers(child: ChildProcess): void {
    child.stdout?.on('data', (data: Buffer) => this.consumeOutput(data, false));
    child.stderr?.on('data', (data: Buffer) => this.consumeOutput(data, true));
    child.on('exit', (code, signal) => {
      this.flushOutput();
      const interrupted = code === 0xC000013A;
      const intentional = this.stopping || this.starting || code === 0 || interrupted;
      this.running = false;
      this.ready = false;
      if (child.pid) void this.transport.invalidateProcess(
        child.pid,
        new CognitionTransportError('受监督 Cognition 进程在注册前退出', ServiceErrorCode.UNAVAILABLE, true),
      );
      logger[code === 0 || interrupted ? 'info' : 'warn']('Cognition 认知核进程退出', { code, signal });
      if (!intentional && code !== 0) {
        void this.restart().catch((error) => logger.error('Cognition 自动重启失败', { error: normalizeError(error) }));
      }
    });
    child.on('error', (error) => {
      this.running = false;
      this.ready = false;
      logger.error('Cognition 子进程启动失败', { error: error.message });
    });
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
