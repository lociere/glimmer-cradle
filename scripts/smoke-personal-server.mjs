import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, symlink } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await reserveLoopbackPort();
const baseUrl = `http://127.0.0.1:${port}`;
const traceId = `smoke-personal-server-${Date.now()}`;
const startedAt = Date.now();
const requireTts = process.env.GLIMMER_CRADLE_SMOKE_REQUIRE_TTS === '1';
const dataRoot = await prepareSmokeDataRoot();
const supervisor = spawn(
  process.execPath,
  [path.join(repoRoot, 'scripts', 'launch-product.mjs'), 'personal-server', '--production'],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      GLIMMER_CRADLE_SERVER_HOST: '127.0.0.1',
      GLIMMER_CRADLE_SERVER_PORT: String(port),
      GLIMMER_CRADLE_DATA_ROOT: dataRoot,
    },
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  },
);
const supervisorExit = waitForExit(supervisor);
let surface = null;

try {
  reportStage('waiting_ready', { base_url: baseUrl });
  await waitForReady(baseUrl, supervisor, 180_000);
  reportStage('ready');
  const result = await exerciseConversation(port, traceId);
  reportStage('conversation_complete', {
    reply_after_ms: result.reply.received_after_ms,
    audio_after_ms: result.audio?.received_after_ms ?? null,
    tts_required: requireTts,
  });
  surface = result.surface;
  surface.send(JSON.stringify({
    kind: 'shutdown_request',
    timestamp: Date.now(),
    shutdown_request: {
      requested_by: 'control-surface',
      reason: 'Personal Server production smoke completed',
    },
  }));
  reportStage('shutdown_requested');

  const exit = await withTimeout(supervisorExit, 20_000, '产品组合未在停机期限内退出');
  if (exit.code !== 0 || exit.signal !== null) {
    throw new Error(`产品组合异常退出: code=${exit.code ?? 'null'}, signal=${exit.signal ?? 'null'}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    trace_id: traceId,
    port,
    elapsed_ms: Date.now() - startedAt,
    reply: result.reply,
    audio: result.audio,
    audio_status: result.audioStatus,
    supervisor_exit: exit,
  }, null, 2)}\n`);
} catch (error) {
  await stopSupervisor(supervisor);
  throw error;
} finally {
  if (surface && surface.readyState !== WebSocket.CLOSED) surface.close();
  await rm(dataRoot, { recursive: true, force: true });
}

function exerciseConversation(serverPort, requestTraceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/v1/surface`);
    const frames = [];
    let reply = null;
    let audio = null;
    let audioStatus = null;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(requireTts ? '等待 reply/audio_play 超时' : '等待 reply/audio_status 超时'));
    }, 180_000);

    const complete = () => {
      if (!reply || !isAcceptedAudioStatus(audioStatus)) return;
      if (requireTts && !audio) return;
      clearTimeout(timer);
      resolve({ surface: ws, frames, reply, audio, audioStatus });
    };

    ws.once('open', () => {
      ws.send(JSON.stringify({
        kind: 'chat_input',
        trace_id: requestTraceId,
        timestamp: Date.now(),
        chat_input: {
          text: '请简短回复：这是一轮正常运行测试。',
          source_suffix: 'personal-server-smoke',
        },
      }));
    });
    ws.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      frames.push(frame.kind ?? 'unknown');
      if (frame.kind === 'audio_status') audioStatus = frame.audio_status;
      if (frame.trace_id !== requestTraceId) return;
      if (frame.kind === 'reply') {
        reply = {
          text: frame.reply?.text ?? '',
          received_after_ms: Date.now() - startedAt,
        };
      }
      if (frame.kind === 'audio_play') {
        audio = {
          audio_id: frame.audio_play?.audio_id,
          audio_uri: frame.audio_play?.audio_uri,
          mime_type: frame.audio_play?.mime_type,
          duration_ms: frame.audio_play?.duration_ms,
          received_after_ms: Date.now() - startedAt,
        };
      }
      complete();
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    ws.once('close', () => {
      if (reply && isAcceptedAudioStatus(audioStatus) && (!requireTts || audio)) return;
      clearTimeout(timer);
      reject(new Error('Control Surface 在完成 smoke 前断开'));
    });
  });
}

function isAcceptedAudioStatus(status) {
  if (!status || typeof status !== 'object') return false;
  const acceptedStates = ['disabled', 'ready', 'degraded'];
  if (!acceptedStates.includes(status.tts?.route_state)
    || !acceptedStates.includes(status.asr?.route_state)) return false;
  return !requireTts || ['ready', 'degraded'].includes(status.tts?.route_state);
}

async function waitForReady(base, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProjection = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`产品组合在 ready 前退出: code=${child.exitCode}, signal=${child.signalCode}`);
    }
    try {
      const response = await fetch(`${base}/readyz`);
      const projection = await response.text();
      if (projection !== lastProjection) {
        lastProjection = projection;
        reportStage('readiness_changed', {
          status_code: response.status,
          projection: parseJson(projection),
        });
      }
      if (response.ok) return;
    } catch {
      // Listener 和内部 endpoint 尚未同时就绪。
    }
    await delay(500);
  }
  throw new Error(`Personal Server 未在 ${timeoutMs}ms 内 ready`);
}

function reportStage(stage, details = {}) {
  process.stdout.write(`[personal-server-smoke] ${JSON.stringify({
    stage,
    elapsed_ms: Date.now() - startedAt,
    ...details,
  })}\n`);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!selected) reject(new Error('无法分配 Personal Server smoke 端口'));
        else resolve(selected);
      });
    });
  });
}

async function prepareSmokeDataRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-cradle-personal-server-'));
  for (const domain of ['models', 'packages']) {
    const source = path.join(repoRoot, 'data', domain);
    try {
      await access(source);
    } catch {
      continue;
    }
    await symlink(source, path.join(root, domain), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return root;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stopSupervisor(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
    return;
  }

  child.kill('SIGTERM');
  try {
    await withTimeout(waitForExit(child), 5000, 'supervisor stop timeout');
    return;
  } catch {
    // 最终回收只用于 Supervisor 无法履行所有权时的测试清场。
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
