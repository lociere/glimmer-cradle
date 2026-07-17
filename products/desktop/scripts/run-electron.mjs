#!/usr/bin/env node
/**
 * Electron 开发模式启动器。
 *
 * 存在原因：
 *   Electron 会读取进程级环境变量 `ELECTRON_RUN_AS_NODE`。
 *   该变量只要是非空值，electron.exe 就会以普通 Node.js runtime 启动；
 *   此时 `require('electron')` 返回二进制路径字符串，而不是 Electron API，
 *   main 进程调用 `app.whenReady()` 会直接崩溃。
 *
 *   某些 Windows 开发环境会从父 shell 静默继承这个变量（通常来自 Electron
 *   开发工具或 VSCode 扩展）。这里在启动前强制清理它，让 dev 启动不受
 *   用户全局 shell 环境污染。
 *
 * 同时固定 `VITE_DEV=1`，让 main 进程加载 Vite dev server。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
let outputClosed = false;
let child;

function handleBrokenPipe() {
  outputClosed = true;
  if (child && !child.killed) {
    child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
  }
}

function ignoreBrokenPipe(stream) {
  stream.on('error', (error) => {
    if (error?.code === 'EPIPE') {
      handleBrokenPipe();
      return;
    }
    throw error;
  });
}

function safeWrite(stream, chunk) {
  if (outputClosed || !stream.writable) return;
  try {
    stream.write(chunk);
  } catch (error) {
    if (error?.code === 'EPIPE') {
      handleBrokenPipe();
      return;
    }
    throw error;
  }
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

// 强制进入 Electron 应用模式，不信任继承环境。
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.VITE_DEV = '1';

const electronBin = process.platform === 'win32'
  ? path.join(PKG_ROOT, 'node_modules', '.bin', 'electron.cmd')
  : path.join(PKG_ROOT, 'node_modules', '.bin', 'electron');

child = spawn(electronBin, ['.'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: PKG_ROOT,
  shell: process.platform === 'win32',
});

child.stdout?.on('data', (chunk) => safeWrite(process.stdout, chunk));
child.stderr?.on('data', (chunk) => safeWrite(process.stderr, chunk));

child.on('error', (error) => {
  safeWrite(process.stderr, `[run-electron] failed to start Electron: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

const forwardSignal = (signal) => {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
};
forwardSignal('SIGINT');
forwardSignal('SIGTERM');
