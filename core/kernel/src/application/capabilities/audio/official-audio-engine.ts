import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import fs from 'fs-extra';
import type {
  AudioConfig,
  AudioEngineCommand,
  AudioEngineResponse,
  VoiceConfig,
} from '@glimmer-cradle/protocol';
import { getLogger } from '../../../foundation/logger/logger';
import {
  forceTerminateManagedProcessTree,
  stopManagedProcess,
  waitForManagedProcessExit,
} from '../../../foundation/process/process-supervisor';
import { resolveLogDir, resolveRepoRoot } from '../../../foundation/utils/path-utils';

const logger = getLogger('official-audio-engine');
type AudioCommandName = AudioEngineCommand['command'];
type AudioEngineLane = 'tts' | 'asr';

interface PendingCommand {
  resolve: (response: AudioEngineResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface AudioCommandOptions {
  readonly timeoutMs?: number;
  readonly resetProcessOnTimeout?: boolean;
}

interface AudioEngineEnvironment {
  audioConfig: AudioConfig;
  voiceConfig: VoiceConfig;
  secrets: Record<string, string>;
}

let audioProcessLogDir = path.join(resolveLogDir(), 'application');

export function setOfficialAudioProcessLogRoot(logDir: string): void {
  audioProcessLogDir = path.join(logDir, 'application');
}

function appendAudioProcessLog(lane: AudioEngineLane, record: Record<string, unknown>): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'official-audio-engine',
    lane,
    ...record,
  });
  fs.ensureDir(audioProcessLogDir)
    .then(() => fs.appendFile(path.join(audioProcessLogDir, `audio-${lane}.console.log`), `${line}\n`, 'utf8'))
    .catch((error) => console.error('写入官方音频子进程日志失败', error));
}

export class OfficialAudioEngineClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stoppingProcess: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingCommand>();
  private nextId = 1;
  private environment: AudioEngineEnvironment | null = null;

  constructor(
    private readonly lane: AudioEngineLane,
    private readonly engineDir = path.join(resolveRepoRoot(), 'engines', 'audio'),
    private readonly timeoutMs = resolveAudioEngineTimeout(lane),
  ) {}

  configure(environment: AudioEngineEnvironment): void {
    if (this.process) {
      throw new Error(`audio engine ${this.lane} 已启动，不能再修改配置`);
    }
    this.environment = environment;
  }

  async request(
    command: AudioCommandName,
    payload: Record<string, unknown>,
    options?: AudioCommandOptions,
  ): Promise<AudioEngineResponse> {
    const child = this.ensureProcess();
    const id = `audio-${this.lane}-${Date.now()}-${this.nextId++}`;
    const message: AudioEngineCommand = { id, command, payload };
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    return new Promise<AudioEngineResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`audio engine ${this.lane} lane command timed out: ${command}`);
        reject(error);
        if (options?.resetProcessOnTimeout !== false) this.resetProcess(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process;
    if (!this.environment) {
      throw new Error(`audio engine ${this.lane} 尚未配置`);
    }
    const child = spawn('uv', [
      'run', '--project', this.engineDir, '--extra', this.lane, 'glimmer-cradle-audio',
    ], {
      cwd: this.engineDir,
      env: {
        ...process.env,
        ...this.environment.secrets,
        GLIMMER_CRADLE_AUDIO_LANE: this.lane,
        GLIMMER_CRADLE_AUDIO_CONFIG: JSON.stringify(this.environment.audioConfig),
        GLIMMER_CRADLE_VOICE_CONFIG: JSON.stringify(this.environment.voiceConfig),
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => this.handleProcessLogLine('stderr', line));
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code, signal) => {
      const expected = this.stoppingProcess === child;
      if (expected && code === 0) {
        logger.info('官方音频引擎已正常退出', { lane: this.lane, code, signal });
      } else {
        logger.warn('官方音频引擎已退出', { lane: this.lane, code, signal, expected });
      }
      if (this.process === child) this.process = null;
      if (this.stoppingProcess === child) this.stoppingProcess = null;
      this.failAll(new Error(`audio engine exited: code=${code}, signal=${signal}`));
    });
    logger.info('官方音频引擎已启动', {
      lane: this.lane,
      cwd: this.engineDir,
      uv_extra: this.lane,
      timeout_ms: this.timeoutMs,
    });
    return child;
  }

  private handleLine(line: string): void {
    let response: AudioEngineResponse;
    try {
      response = JSON.parse(line) as AudioEngineResponse;
    } catch {
      this.handleProcessLogLine('stdout', line);
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      logger.debug('官方音频引擎返回了未知请求', { lane: this.lane, id: response.id });
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private handleProcessLogLine(stream: 'stdout' | 'stderr', line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    appendAudioProcessLog(this.lane, {
      stream,
      level: classifyAudioProcessLine(trimmed),
      message: trimmed,
    });
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private resetProcess(error: Error): void {
    const child = this.process;
    this.process = null;
    this.failAll(error);
    void stopManagedProcess(child, { label: `官方音频引擎 ${this.lane}` });
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    this.stoppingProcess = child;
    this.failAll(new Error(`audio engine ${this.lane} lane stopped`));
    try {
      const response = await this.request('host.shutdown', {}, {
        timeoutMs: 1000,
        resetProcessOnTimeout: false,
      });
      if (response.status !== 'success') {
        throw new Error(response.error?.message ?? 'audio engine 拒绝停机请求');
      }
      if (await waitForManagedProcessExit(child, 2500)) {
        return;
      }
      logger.warn('官方音频引擎未在协议停机期限内退出', { lane: this.lane });
    } catch (error) {
      logger.warn('官方音频引擎协议停机失败，转入受管进程回收', {
        lane: this.lane,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await forceTerminateManagedProcessTree(
      child,
      `官方音频引擎 ${this.lane}`,
      1000,
      process.platform !== 'win32',
    );
  }
}

const ttsClient = new OfficialAudioEngineClient('tts');
const asrClient = new OfficialAudioEngineClient('asr');

export function configureOfficialAudioEngine(
  audioConfig: AudioConfig,
  voiceConfig: VoiceConfig,
  secrets: Record<string, string>,
): void {
  const environment = { audioConfig, voiceConfig, secrets };
  ttsClient.configure(environment);
  asrClient.configure(environment);
}

export async function probeOfficialAudioEngine(options?: {
  tts?: boolean;
  asr?: boolean;
}): Promise<AudioEngineResponse> {
  const [tts, asr] = await Promise.all([
    options?.tts === false ? Promise.resolve(null) : toSettled(ttsClient.request('health', {})),
    options?.asr === false ? Promise.resolve(null) : toSettled(asrClient.request('health', {})),
  ]);
  return {
    id: `audio-health-${Date.now()}`,
    status: 'success',
    payload: {
      providers: {
        ...(tts ? { tts: readLaneHealth(tts, 'tts') } : {}),
        ...(asr ? { asr: readLaneHealth(asr, 'asr') } : {}),
      },
    },
  };
}

export const warmupOfficialAudioASR = (): Promise<AudioEngineResponse> => asrClient.request('asr.warmup', {});
export const warmupOfficialAudioTTS = (): Promise<AudioEngineResponse> => ttsClient.request('tts.warmup', {});
export const synthesizeOfficialAudioTTS = (
  text: string,
  outputPath: string,
): Promise<AudioEngineResponse> => ttsClient.request('tts.synthesize', { text, output_path: outputPath });
export const recognizeOfficialAudioASR = (
  audioPath: string,
): Promise<AudioEngineResponse> => asrClient.request('asr.recognize', { audio_path: audioPath });

export async function stopOfficialAudioEngines(): Promise<void> {
  await Promise.all([ttsClient.stop(), asrClient.stop()]);
}

function resolveAudioEngineTimeout(lane: AudioEngineLane): number {
  const raw = lane === 'tts'
    ? process.env.GLIMMER_CRADLE_AUDIO_TTS_TIMEOUT_MS
    : process.env.GLIMMER_CRADLE_AUDIO_ASR_TIMEOUT_MS;
  const parsed = Number(raw ?? process.env.GLIMMER_CRADLE_AUDIO_ENGINE_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return lane === 'asr' ? 300000 : 240000;
}

function readLaneHealth(
  result: PromiseSettledResult<AudioEngineResponse>,
  lane: AudioEngineLane,
): Record<string, unknown> {
  if (result.status === 'rejected') {
    return {
      route_state: 'unavailable',
      providers: [],
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  }
  if (result.value.status !== 'success') {
    return {
      route_state: 'unavailable',
      providers: [],
      message: result.value.error?.message ?? `audio engine ${lane} health failed`,
    };
  }
  const providers = result.value.payload?.providers as Record<string, unknown> | undefined;
  return (providers?.[lane] as Record<string, unknown> | undefined) ?? {
    route_state: 'unavailable',
    providers: [],
    message: `audio engine ${lane} health missing lane snapshot`,
  };
}

async function toSettled<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function classifyAudioProcessLine(line: string): 'debug' | 'info' | 'warn' | 'error' {
  if (/traceback|exception|fatal|critical|error:/i.test(line)) return 'error';
  if (/warning|warn/i.test(line)) return 'warn';
  if (/download|loading|building|notice|debug|modelscope|jieba/i.test(line)) return 'debug';
  return 'info';
}
