import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';

export interface ProcessTreeStartRequest { readonly program: string; readonly args: readonly string[]; readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly session: string; }
export interface ProcessTreeAuthority { start(request: ProcessTreeStartRequest): Promise<ProcessTreeChild>; stop(): Promise<{ terminated: boolean; active_process_count: number }>; }
export interface ProcessTreeChild { readonly pid?: number; readonly exitCode: number | null; readonly signalCode: NodeJS.Signals | null; once(event: 'error', listener: (error: Error) => void): this; once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this; kill(signal?: NodeJS.Signals): boolean; }

export class NativeProcessTreeAuthority implements ProcessTreeAuthority {
  private helper: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, (value: Record<string, unknown>) => void>();
  private sequence = 0;
  private session = '';

  public constructor(private readonly helperPath: string, private readonly spawnHelper = spawn) {}

  public async start(request: ProcessTreeStartRequest): Promise<ProcessTreeChild> {
    this.session = request.session;
    await this.ensureHelper(request.cwd, request.env);
    const response = await this.request({
      op: 'start', session: request.session,
      command_line: [request.program, ...request.args].map(quoteWindowsArgument).join(' '),
      cwd: request.cwd,
    });
    if (response.status !== 'started' || typeof response.root_pid !== 'number') throw new Error('desktop_process_tree_start_failed');
    return new BridgeChild(response.root_pid, this);
  }

  public async stop(): Promise<{ terminated: boolean; active_process_count: number }> {
    if (!this.helper) return { terminated: true, active_process_count: 0 };
    const response = await this.request({ op: 'stop', session: this.session });
    const result = { terminated: response.status === 'terminated', active_process_count: Number(response.active_process_count ?? -1) };
    if (result.terminated) { this.helper.stdin.end(); this.helper = null; }
    return result;
  }

  private async ensureHelper(cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    if (this.helper) return;
    const helper = this.spawnHelper(this.helperPath, [], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.helper = helper;
    const lines = createInterface({ input: helper.stdout });
    lines.on('line', (line) => { try { const message = JSON.parse(line) as Record<string, unknown>; const id = String(message.request_id ?? ''); const resolve = this.pending.get(id); if (resolve) { this.pending.delete(id); resolve(message); } } catch { /* malformed helper output is ignored and timeout fails closed */ } });
    helper.once('exit', () => { this.helper = null; for (const resolve of this.pending.values()) resolve({ status: 'failed', error_code: 'helper_exit' }); this.pending.clear(); });
  }

  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.helper) return Promise.reject(new Error('desktop_process_tree_helper_unavailable'));
    const requestId = `req-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('desktop_process_tree_protocol_timeout')); }, 10_000);
      this.pending.set(requestId, (value) => { clearTimeout(timer); resolve(value); });
      this.helper!.stdin.write(`${JSON.stringify({ ...payload, request_id: requestId })}\n`);
    });
  }
}

class BridgeChild extends EventEmitter implements ProcessTreeChild {
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public constructor(public readonly pid: number, private readonly authority: ProcessTreeAuthority) { super(); }
  public kill(signal: NodeJS.Signals = 'SIGTERM'): boolean { void this.authority.stop().then(() => { this.signalCode = signal; this.emit('exit', null, signal); }); return true; }
}

export function isProcessTreeChild(value: unknown): value is ProcessTreeChild { return Boolean(value && typeof (value as ProcessTreeChild).kill === 'function'); }

function quoteWindowsArgument(value: string): string { return `\"${value.replaceAll('\\', '\\\\').replaceAll('\"', '\\\"')}\"`; }
