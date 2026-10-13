import { create, type Message } from '@bufbuild/protobuf';
import * as grpc from '@grpc/grpc-js';
import fs from 'fs-extra';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { AudioConfig } from '../../domain/config';
import type { VoiceConfig } from '../config/documents/VoiceConfig';
import {
  AudioLane,
  AudioMediaReferenceSchema,
  HealthRequestSchema,
  HealthResponseSchema,
  MediaAccess,
  RecognizeRequestSchema,
  RecognizeResponseSchema,
  ShutdownRequestSchema,
  ShutdownResponseSchema,
  SynthesizeRequestSchema,
  SynthesizeResponseSchema,
  WarmupRequestSchema,
  WarmupResponseSchema,
  type AudioMediaReference,
  type HealthResponse,
  type WarmupResponse,
} from '@glimmer-cradle/contracts/glimmer/engine/audio/v1/audio_engine_pb';
import { CallMetadataSchema } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { getLogger } from '../observability/logger';
import { ManagedProcessSupervisor } from '@glimmer-cradle/platform';
import { resolveLogDir, resolveRepoRoot, resolveWorkPath, resolveManagedProcessBridge } from '../filesystem/path-utils';
import { audioUnaryMethod } from './audio-grpc-contract';

const logger = getLogger('official-audio-engine');
const processSupervisor = new ManagedProcessSupervisor(logger);
const AUTH_HEADER = 'x-glimmer-audio-token';
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const LEASE_GRACE_MS = 30_000;
type AudioEngineLane = 'tts' | 'asr';
type AudioChild = ChildProcessByStdio<null, Readable, Readable>;

export interface OfficialAudioEngineResult {
  readonly status: 'success' | 'error';
  readonly payload?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
}

interface AudioEngineEnvironment {
  audioConfig: AudioConfig;
  voiceConfig: VoiceConfig;
  secrets: Record<string, string>;
}

interface RunningAudioHost {
  readonly child: AudioChild;
  readonly client: grpc.Client;
  readonly token: string;
}

let audioProcessLogDir = path.join(resolveLogDir(), 'application');

export function setOfficialAudioProcessLogRoot(logDir: string): void {
  audioProcessLogDir = path.join(logDir, 'application');
}

function appendAudioProcessLog(lane: AudioEngineLane, record: Record<string, unknown>): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), source: 'official-audio-engine', lane, ...record });
  fs.ensureDir(audioProcessLogDir)
    .then(() => fs.appendFile(path.join(audioProcessLogDir, `audio-${lane}.console.log`), `${line}\n`, 'utf8'))
    .catch((error: unknown) => console.error('写入官方音频子进程日志失败', error));
}

export class OfficialAudioEngineClient {
  private process: AudioChild | null = null;
  private running: RunningAudioHost | null = null;
  private starting: Promise<RunningAudioHost> | null = null;
  private resetting: Promise<void> = Promise.resolve();
  private stoppingProcess: AudioChild | null = null;
  private resettingFailed = false;
  private stopOperation: Promise<void> | undefined;
  private environment: AudioEngineEnvironment | null = null;
  private readonly mediaRoot: string;

  constructor(
    private readonly lane: AudioEngineLane,
    private readonly engineDir = path.join(resolveRepoRoot(), 'engines', 'audio'),
    private readonly timeoutMs = resolveAudioEngineTimeout(lane),
  ) {
    this.mediaRoot = resolveWorkPath(path.join('audio', 'media-leases', lane));
  }

  configure(environment: AudioEngineEnvironment): void {
    if (this.process) throw new Error(`audio engine ${this.lane} 已启动，不能再修改配置`);
    this.environment = environment;
  }

  async health(): Promise<OfficialAudioEngineResult> {
    const response = await this.call(
      audioUnaryMethod('Health', HealthRequestSchema, HealthResponseSchema),
      create(HealthRequestSchema, { call: this.callMetadata('health') }),
    );
    return fromSnapshotResponse(response);
  }

  async warmup(): Promise<OfficialAudioEngineResult> {
    const response = await this.call(
      audioUnaryMethod('Warmup', WarmupRequestSchema, WarmupResponseSchema),
      create(WarmupRequestSchema, {
        call: this.callMetadata('warmup'),
        lane: this.lane === 'tts' ? AudioLane.TTS : AudioLane.ASR,
      }),
    );
    return fromSnapshotResponse(response);
  }

  async synthesize(text: string, outputPath: string): Promise<OfficialAudioEngineResult> {
    await this.ensureProcess();
    const lease = await this.createOutputLease();
    try {
      const response = await this.call(
        audioUnaryMethod('Synthesize', SynthesizeRequestSchema, SynthesizeResponseSchema),
        create(SynthesizeRequestSchema, { call: this.callMetadata('synthesize'), text, output: lease.reference }),
      );
      if (response.failure) return failureResponse(response.failure.code, response.failure.safeMessage);
      if (!response.output) return failureResponse('invalid_response', 'Audio Engine 未返回输出媒体引用');
      await this.validateCompletedOutput(lease.reference, response.output, lease.filePath);
      await fs.ensureDir(path.dirname(outputPath));
      await fs.move(lease.filePath, outputPath, { overwrite: true });
      return {
        status: 'success',
        payload: {
          output_path: outputPath,
          provider_id: response.providerId,
          fallback_used: response.fallbackUsed,
          duration_ms: response.durationMs,
        },
      };
    } finally {
      await fs.remove(lease.leaseDir);
    }
  }

  async recognize(inputPath: string): Promise<OfficialAudioEngineResult> {
    await this.ensureProcess();
    const lease = await this.createInputLease(inputPath);
    try {
      const response = await this.call(
        audioUnaryMethod('Recognize', RecognizeRequestSchema, RecognizeResponseSchema),
        create(RecognizeRequestSchema, { call: this.callMetadata('recognize'), input: lease.reference }),
      );
      if (response.failure) return failureResponse(response.failure.code, response.failure.safeMessage);
      return {
        status: 'success',
        payload: { text: response.text, provider_id: response.providerId, duration_ms: response.durationMs },
      };
    } finally {
      await fs.remove(lease.leaseDir);
    }
  }

  private async call<I extends Message, O extends Message>(
    method: grpc.MethodDefinition<I, O>,
    request: I,
    timeoutMs = this.timeoutMs,
    allowClosing = false,
  ): Promise<O> {
    const running = allowClosing ? this.running : await this.ensureProcess();
    if (!running) throw new Error("audio engine 停机时连接已关闭");
    const metadata = new grpc.Metadata();
    metadata.set(AUTH_HEADER, running.token);
    return new Promise<O>((resolve, reject) => {
      running.client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        metadata,
        { deadline: Date.now() + timeoutMs },
        (error, response) => {
          if (!error && response) return resolve(response);
          const failure = error ?? new Error(`audio engine ${this.lane} returned no response`);
          reject(failure);
          if (!allowClosing && error?.code === grpc.status.DEADLINE_EXCEEDED) this.resetProcess(failure);
        },
      );
    });
  }

  private async ensureProcess(): Promise<RunningAudioHost> {
    if (this.stopOperation || this.stoppingProcess || this.resettingFailed) throw new Error("audio engine 正在关闭或上代回收失败");
    if (this.running && this.process?.exitCode === null && this.process.signalCode === null) return this.running;
    if (this.starting) return this.starting;
    if (this.process || this.resettingFailed || this.stoppingProcess) throw new Error('audio engine 上代进程尚未释放');
    this.starting = this.startProcess();
    try {
      this.running = await this.starting;
      return this.running;
    } finally {
      this.starting = null;
    }
  }

  private async startProcess(): Promise<RunningAudioHost> {
    if (!this.environment) throw new Error(`audio engine ${this.lane} 尚未配置`);
    await this.resetting;
    await fs.remove(this.mediaRoot);
    await fs.ensureDir(this.mediaRoot);
    const token = randomBytes(32).toString('base64url');
    const packagedPython = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME?.trim();
    const command = packagedPython || 'uv';
    const args = packagedPython
      ? ['-m', 'glimmer_cradle.audio.main']
      : ['run', '--project', this.engineDir, '--extra', this.lane, 'glimmer-cradle-audio'];
    const child = processSupervisor.spawnManagedProcess(command, args, {
      cwd: packagedPython ? resolveRepoRoot() : this.engineDir,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ...this.environment.secrets,
        GLIMMER_CRADLE_AUDIO_LANE: this.lane,
        GLIMMER_CRADLE_AUDIO_CONFIG: JSON.stringify(this.environment.audioConfig),
        GLIMMER_CRADLE_VOICE_CONFIG: JSON.stringify(this.environment.voiceConfig),
        GLIMMER_CRADLE_AUDIO_TOKEN: token,
        GLIMMER_CRADLE_AUDIO_MEDIA_ROOT: this.mediaRoot,
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }, resolveManagedProcessBridge(), spawn) as AudioChild;
    this.process = child;
    processSupervisor.observeManagedProcess(child, process.platform !== 'win32');
    readline.createInterface({ input: child.stderr }).on('line', (line) => this.handleProcessLogLine('stderr', line));
    child.on('error', (error) => logger.warn('官方音频引擎进程错误', { lane: this.lane, error: error.message }));
    processSupervisor.onManagedProcessExit(child, (code, signal) => this.handleExit(child, code, signal));
    processSupervisor.onManagedProcessRootExit(child, (code, signal) => this.handleExit(child, code, signal));
    let endpoint: string;
    try {
      const bootstrapEndpoint = readBootstrapEndpoint(
        child.stdout,
        child,
        BOOTSTRAP_TIMEOUT_MS,
        (line) => this.handleProcessLogLine('stdout', line),
      );
      const results = await Promise.all([bootstrapEndpoint, processSupervisor.waitForManagedProcessReady(child, BOOTSTRAP_TIMEOUT_MS)]);
      endpoint = results[0];
      if (!processSupervisor.isManagedProcessRootRunning(child)) throw new Error('audio engine bootstrap 根已退出');
    } catch (error) {
      await processSupervisor.stopManagedProcess(child, { label: `官方音频引擎 ${this.lane} bootstrap`, ownsProcessGroup: process.platform !== 'win32' });
      if (this.process === child) this.process = null;
      await fs.remove(this.mediaRoot);
      throw error;
    }
    const client = new grpc.Client(endpoint, grpc.credentials.createInsecure());
    logger.info('官方音频引擎已启动', {
      lane: this.lane,
      endpoint,
      launch_mode: packagedPython ? 'packaged-python-runtime' : 'uv-project',
      timeout_ms: this.timeoutMs,
    });
    return { child, client, token };
  }

  private handleExit(child: AudioChild, code: number | null, signal: NodeJS.Signals | null): void {
    const expected = this.stoppingProcess === child;
    const ownsCurrentProcess = this.process === child;
    const released = processSupervisor.isProcessReleased(child);
    if (this.running?.child === child) {
      this.running.client.close();
      this.running = null;
    }
    if (ownsCurrentProcess && released) this.process = null;
    if (this.stoppingProcess === child && released) this.stoppingProcess = null;
    if (ownsCurrentProcess && released) void fs.remove(this.mediaRoot);
    const record = { lane: this.lane, code, signal, expected };
    if (expected && code === 0) logger.info('官方音频引擎已正常退出', record);
    else logger.warn('官方音频引擎已退出', record);
  }

  private resetProcess(error: Error): void {
    const child = this.process;
    this.running?.client.close();
    this.running = null;
    this.stoppingProcess = child;
    this.resetting = (async () => {
      await processSupervisor.stopManagedProcess(child, { label: `官方音频引擎 ${this.lane}`, ownsProcessGroup: process.platform !== 'win32' });
      if (this.process === child) this.process = null;
      if (this.stoppingProcess === child) this.stoppingProcess = null;
      this.resettingFailed = false;
      await fs.remove(this.mediaRoot);
    })();
    void this.resetting.catch(() => { this.resettingFailed = true; });
    logger.warn('官方音频引擎连接已重置', { lane: this.lane, error: error.message });
  }

  stop(): Promise<void> {
    if (this.stopOperation) return this.stopOperation;
    let resolveStop!: () => void;
    let rejectStop!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
    this.stopOperation = operation;
    void this.stopChild().then(resolveStop, rejectStop);
    void operation.then(() => { this.stopOperation = undefined; }, () => { this.stopOperation = undefined; });
    return operation;
  }

  private async stopChild(): Promise<void> {
    await this.starting?.catch(() => undefined);
    await this.resetting.catch(() => undefined);
    const child = this.process;
    const running = this.running;
    if (!child || processSupervisor.isProcessReleased(child)) {
      this.running?.client.close();
      this.running = null;
      this.process = null;
      this.stoppingProcess = null;
      this.resettingFailed = false;
      this.resetting = Promise.resolve();
      await fs.remove(this.mediaRoot);
      return;
    }
    this.stoppingProcess = child;
    let processStopped = false;
    try {
      if (!running) {
        await processSupervisor.stopManagedProcess(child, { label: `官方音频引擎 ${this.lane} bootstrap` });
        processStopped = true;
        return;
      }
      try {
        const response = await this.call(
          audioUnaryMethod('Shutdown', ShutdownRequestSchema, ShutdownResponseSchema),
          create(ShutdownRequestSchema, { call: this.callMetadata('shutdown'), reason: 'kernel shutdown' }),
          1000,
          true,
        );
        if (response.failure || !response.accepted) throw new Error(response.failure?.safeMessage ?? 'audio engine 拒绝停机请求');
        if (await processSupervisor.waitForManagedProcessExit(child, 2500)) {
          if (!processSupervisor.isProcessReleased(child)) throw new Error('audio engine 子树回收未确认');
          processStopped = true;
          return;
        }
        logger.warn('官方音频引擎未在协议停机期限内退出', { lane: this.lane });
      } catch (error) {
        logger.warn('官方音频引擎协议停机失败，转入受管进程回收', {
          lane: this.lane,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await processSupervisor.forceTerminateManagedProcessTree(child, `官方音频引擎 ${this.lane}`, 1000, process.platform !== 'win32');
      processStopped = true;
    } finally {
      if (processStopped || processSupervisor.isProcessReleased(child)) {
        this.running?.client.close();
        this.running = null;
        if (this.process === child) this.process = null;
        if (this.stoppingProcess === child) this.stoppingProcess = null;
        this.resettingFailed = false;
        this.resetting = Promise.resolve();
        await fs.remove(this.mediaRoot);
      } else this.resettingFailed = true;
    }
  }

  private callMetadata(operation: string) {
    return create(CallMetadataSchema, { traceId: `audio-${this.lane}-${operation}-${randomUUID()}` });
  }

  private async createOutputLease() {
    const leaseId = randomUUID();
    const leaseDir = path.join(this.mediaRoot, leaseId);
    const filePath = path.join(leaseDir, 'output.wav');
    await fs.ensureDir(leaseDir);
    return {
      leaseDir,
      filePath,
      reference: create(AudioMediaReferenceSchema, {
        leaseId,
        uri: pathToFileURL(filePath).href,
        mimeType: 'audio/wav',
        expiresAtMs: BigInt(Date.now() + this.timeoutMs + LEASE_GRACE_MS),
        access: MediaAccess.WRITE_ONCE,
      }),
    };
  }

  private async createInputLease(sourcePath: string) {
    const leaseId = randomUUID();
    const leaseDir = path.join(this.mediaRoot, leaseId);
    const filePath = path.join(leaseDir, `input${path.extname(sourcePath) || '.audio'}`);
    await fs.ensureDir(leaseDir);
    await fs.copyFile(sourcePath, filePath);
    const stat = await fs.stat(filePath);
    return {
      leaseDir,
      reference: create(AudioMediaReferenceSchema, {
        leaseId,
        uri: pathToFileURL(filePath).href,
        mimeType: mimeTypeForPath(filePath),
        sizeBytes: BigInt(stat.size),
        sha256: await sha256File(filePath),
        expiresAtMs: BigInt(Date.now() + this.timeoutMs + LEASE_GRACE_MS),
        access: MediaAccess.READ_ONLY,
      }),
    };
  }

  private async validateCompletedOutput(requested: AudioMediaReference, completed: AudioMediaReference, filePath: string): Promise<void> {
    if (
      completed.leaseId !== requested.leaseId
      || completed.uri !== requested.uri
      || completed.access !== MediaAccess.WRITE_ONCE
      || completed.expiresAtMs !== requested.expiresAtMs
    ) throw new Error('Audio Engine 返回了不属于当前租约的媒体引用');
    const stat = await fs.stat(filePath);
    const digest = await sha256File(filePath);
    if (completed.sizeBytes !== BigInt(stat.size) || completed.sha256 !== digest) {
      throw new Error('Audio Engine 输出媒体的长度或摘要校验失败');
    }
  }

  private handleProcessLogLine(stream: 'stdout' | 'stderr', line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    appendAudioProcessLog(this.lane, { stream, level: classifyAudioProcessLine(trimmed), message: trimmed });
  }
}

const ttsClient = new OfficialAudioEngineClient('tts');
const asrClient = new OfficialAudioEngineClient('asr');

export function configureOfficialAudioEngine(audioConfig: AudioConfig, voiceConfig: VoiceConfig, secrets: Record<string, string>): void {
  const environment = { audioConfig, voiceConfig, secrets };
  ttsClient.configure(environment);
  asrClient.configure(environment);
}

export async function probeOfficialAudioEngine(options?: { tts?: boolean; asr?: boolean }): Promise<OfficialAudioEngineResult> {
  const [tts, asr] = await Promise.all([
    options?.tts === false ? Promise.resolve(null) : toSettled(ttsClient.health()),
    options?.asr === false ? Promise.resolve(null) : toSettled(asrClient.health()),
  ]);
  return {
    status: 'success',
    payload: { providers: { ...(tts ? { tts: readLaneHealth(tts, 'tts') } : {}), ...(asr ? { asr: readLaneHealth(asr, 'asr') } : {}) } },
  };
}

export const warmupOfficialAudioASR = (): Promise<OfficialAudioEngineResult> => asrClient.warmup();
export const warmupOfficialAudioTTS = (): Promise<OfficialAudioEngineResult> => ttsClient.warmup();
export const synthesizeOfficialAudioTTS = (text: string, outputPath: string): Promise<OfficialAudioEngineResult> => ttsClient.synthesize(text, outputPath);
export const recognizeOfficialAudioASR = (audioPath: string): Promise<OfficialAudioEngineResult> => asrClient.recognize(audioPath);

export async function stopOfficialAudioEngines(): Promise<void> {
  await Promise.all([ttsClient.stop(), asrClient.stop()]);
}

function resolveAudioEngineTimeout(lane: AudioEngineLane): number {
  const raw = lane === 'tts' ? process.env.GLIMMER_CRADLE_AUDIO_TTS_TIMEOUT_MS : process.env.GLIMMER_CRADLE_AUDIO_ASR_TIMEOUT_MS;
  const parsed = Number(raw ?? process.env.GLIMMER_CRADLE_AUDIO_ENGINE_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return lane === 'asr' ? 300000 : 240000;
}

function fromSnapshotResponse(response: HealthResponse | WarmupResponse): OfficialAudioEngineResult {
  if (response.failure) return failureResponse(response.failure.code, response.failure.safeMessage);
  return { status: 'success', payload: (response.snapshot ?? {}) as Record<string, unknown> };
}

function failureResponse(code: string, message: string): OfficialAudioEngineResult {
  return { status: 'error', error: { code, message } };
}

function readLaneHealth(result: PromiseSettledResult<OfficialAudioEngineResult>, lane: AudioEngineLane): Record<string, unknown> {
  if (result.status === 'rejected') return { route_state: 'unavailable', providers: [], message: result.reason instanceof Error ? result.reason.message : String(result.reason) };
  if (result.value.status !== 'success') return { route_state: 'unavailable', providers: [], message: result.value.error?.message ?? `audio engine ${lane} health failed` };
  const providers = result.value.payload?.providers as Record<string, unknown> | undefined;
  return (providers?.[lane] as Record<string, unknown> | undefined) ?? { route_state: 'unavailable', providers: [], message: `audio engine ${lane} health missing lane snapshot` };
}

async function readBootstrapEndpoint(
  pipe: Readable,
  child: ChildProcess,
  timeoutMs: number,
  onLogLine: (line: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: pipe });
    let settled = false;
    const finish = (error?: Error, endpoint?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      pipe.off('error', onError);
      lines.off('close', onClose);
      if (error) { lines.removeAllListeners('line'); lines.close(); }
      if (error) reject(error);
      else resolve(endpoint!);
    };
    const timer = setTimeout(() => finish(new Error('audio engine endpoint bootstrap timed out')), timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(new Error(`audio engine exited before bootstrap: code=${code}, signal=${signal}`));
    const onError = (error: Error) => finish(error);
    const onClose = () => finish(new Error('audio engine stdout closed before bootstrap'));
    child.once('exit', onExit);
    child.once('error', onError);
    pipe.once('error', onError);
    lines.once('close', onClose);
    lines.on('line', (line) => {
      const match = /^GLIMMER_AUDIO_ENDPOINT=(127\.0\.0\.1:\d+)$/.exec(line.trim());
      if (match && !settled) finish(undefined, match[1]);
      else onLogLine(line);
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.flac') return 'audio/flac';
  return 'application/octet-stream';
}

async function toSettled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try { return { status: 'fulfilled', value: await promise }; }
  catch (reason) { return { status: 'rejected', reason }; }
}

function classifyAudioProcessLine(line: string): 'debug' | 'info' | 'warn' | 'error' {
  if (/traceback|exception|fatal|critical|error:/i.test(line)) return 'error';
  if (/warning|warn/i.test(line)) return 'warn';
  if (/download|loading|building|notice|debug|modelscope|jieba/i.test(line)) return 'debug';
  return 'info';
}
