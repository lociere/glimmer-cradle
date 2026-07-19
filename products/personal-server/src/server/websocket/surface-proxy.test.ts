import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { proxySurfaceConnection } from './surface-proxy';

test('cancels previewed extension transactions when the browser websocket disconnects', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await waitForServer(upstream);
  const upstreamUrl = socketUrl(upstream);
  const clientIngress = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await waitForServer(clientIngress);
  clientIngress.on('connection', (socket) => {
    proxySurfaceConnection(socket, upstreamUrl, {
      extensionUploadAuthorization: {
        principalId: 'token-a',
        sessionBinding: 'session:a',
      },
    });
  });

  const cancelSeen = new Promise<void>((resolve, reject) => {
    upstream.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (frame.kind === 'extension_install_prepare') {
          socket.send(JSON.stringify({
            kind: 'extension_install_preview',
            timestamp: Date.now(),
            extension_install_preview: {
              request_id: 'prepare-1',
              status: 'ready',
              transaction_id: 'tx-preview-1',
            },
          }));
          return;
        }
        if (frame.kind === 'extension_install_cancel') {
          try {
            const payload = frame.extension_install_cancel as Record<string, unknown>;
            assert.equal(payload.transaction_id, 'tx-preview-1');
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  });

  const browser = new WebSocket(socketUrl(clientIngress));
  await waitForOpen(browser);
  browser.send(JSON.stringify({
    kind: 'extension_install_prepare',
    timestamp: Date.now(),
    extension_install_prepare: {
      request_id: 'prepare-1',
      source: {
        kind: 'repository',
        repository: 'https://github.com/example/community-extension',
        tag: 'v1.0.0',
      },
    },
  }));
  await onceJsonMessage(browser);
  browser.close();

  await withTimeout(cancelSeen, 2_000, 'expected proxy to cancel previewed transaction after disconnect');
  await closeSocket(browser);
  await closeServer(clientIngress);
  await closeServer(upstream);
});

test('rejects commit requests for transactions owned by another session or unknown to this connection', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await waitForServer(upstream);
  const upstreamUrl = socketUrl(upstream);
  let upstreamCommitSeen = false;
  upstream.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.kind === 'extension_install_commit') upstreamCommitSeen = true;
    });
  });

  const ingressA = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const ingressB = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await Promise.all([waitForServer(ingressA), waitForServer(ingressB)]);
  ingressA.on('connection', (socket) => {
    proxySurfaceConnection(socket, upstreamUrl, {
      extensionUploadAuthorization: { principalId: 'token-a', sessionBinding: 'session:a' },
    });
  });
  ingressB.on('connection', (socket) => {
    proxySurfaceConnection(socket, upstreamUrl, {
      extensionUploadAuthorization: { principalId: 'token-b', sessionBinding: 'session:b' },
    });
  });

  const browserA = new WebSocket(socketUrl(ingressA));
  await waitForOpen(browserA);
  const browserB = new WebSocket(socketUrl(ingressB));
  await waitForOpen(browserB);

  browserB.send(JSON.stringify({
    kind: 'extension_install_commit',
    timestamp: Date.now(),
    extension_install_commit: {
      request_id: 'commit-foreign',
      transaction_id: 'tx-preview-1',
      approved_permissions: [],
    },
  }));
  const response = await withTimeout(onceJsonMessage(browserB), 2_000, 'expected proxy to reject foreign transaction commit');
  assert.equal(response.kind, 'extension_install_result');
  assert.equal(response.extension_install_result?.status, 'error');
  assert.match(response.extension_install_result?.message || '', /当前登录会话|已过期|不存在/);
  assert.equal(upstreamCommitSeen, false);

  await Promise.all([
    closeSocket(browserA),
    closeSocket(browserB),
    closeServer(ingressA),
    closeServer(ingressB),
    closeServer(upstream),
  ]);
});

function socketUrl(server: WebSocketServer): string {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('websocket server did not bind');
  }
  return `ws://127.0.0.1:${address.port}`;
}

function waitForServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function onceJsonMessage(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: RawData): void => {
      cleanup();
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.once('error', onError);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once('close', () => resolve());
    socket.close();
  });
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]);
}
