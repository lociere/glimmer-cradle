import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { KernelReadinessMonitor } from './kernel-readiness-monitor';
import { loadPersonalServerProductManifest } from './product-manifest';
import { isSameOrigin, requestClientId, SessionManager } from './session-manager';

interface EndpointCatalog {
  readonly generation: string;
  readonly endpoints: ReadonlyArray<{ purpose: string; endpoint: string }>;
}

const host = process.env.GLIMMER_CRADLE_SERVER_HOST?.trim() || '127.0.0.1';
const port = Number.parseInt(process.env.GLIMMER_CRADLE_SERVER_PORT || '3210', 10);
const token = process.env.GLIMMER_CRADLE_SERVER_TOKEN?.trim() || '';
const productManifestPath = process.env.GLIMMER_CRADLE_PRODUCT_MANIFEST?.trim();
const applicationRoot = productManifestPath
  ? path.resolve(path.dirname(productManifestPath), '..', '..')
  : findApplicationRoot(process.cwd());
const productManifest = loadPersonalServerProductManifest(
  productManifestPath || path.join(applicationRoot, 'products', 'personal-server', 'product.json'),
);
const dataRoot = path.resolve(process.env.GLIMMER_CRADLE_DATA_ROOT || path.join(applicationRoot, 'data'));
const runRoot = path.resolve(process.env.GLIMMER_CRADLE_RUN_ROOT || path.join(dataRoot, 'run'));
const endpointCatalogPath = path.join(runRoot, 'host', 'endpoints.json');
const publicRoot = path.join(__dirname, 'public');
const sessions = new SessionManager(token);
const kernelReadiness = new KernelReadinessMonitor(
  resolveControlSurfaceEndpoint,
  500,
  () => void stop(),
);
let stopPromise: Promise<void> | null = null;

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`GLIMMER_CRADLE_SERVER_PORT 无效: ${process.env.GLIMMER_CRADLE_SERVER_PORT}`);
}
if (!isLoopback(host) && !token) {
  throw new Error('Personal Server 绑定非回环地址时必须配置 GLIMMER_CRADLE_SERVER_TOKEN');
}

const server = createServer((request, response) => void handleRequest(request, response));
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
kernelReadiness.start();

server.on('upgrade', async (request, socket, head) => {
  if (request.url?.split('?')[0] !== '/api/v1/surface') {
    socket.destroy();
    return;
  }
  if (!isSameOrigin(request) || !sessions.authenticate(request)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const endpoint = await resolveControlSurfaceEndpoint();
  if (!endpoint) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (client) => {
    proxySurfaceConnection(client, endpoint);
  });
});

server.listen(port, host, () => {
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  console.log(`[personal-server] listening on http://${host}:${boundPort}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void stop());
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = request.url?.split('?')[0] || '/';
  if (pathname === '/healthz') {
    sendJson(response, 200, { status: 'ok', product: productManifest.id });
    return;
  }
  if (pathname === '/api/v1/session' && request.method === 'GET') {
    sendJson(response, 200, { authenticated: sessions.authenticate(request) });
    return;
  }
  if (pathname === '/api/v1/session' && request.method === 'POST') {
    await handleLogin(request, response);
    return;
  }
  if (pathname === '/api/v1/session' && request.method === 'DELETE') {
    sessions.logout(request);
    response.setHeader('set-cookie', sessions.clearCookie(request));
    sendJson(response, 200, { authenticated: false });
    return;
  }
  if (pathname === '/' || pathname === '/assets/app.css' || pathname === '/assets/app.js') {
    await serveWebAsset(pathname, response);
    return;
  }
  if (!sessions.authenticate(request)) {
    sendJson(response, 401, { error: 'unauthorized' });
    return;
  }
  if (pathname === '/readyz') {
    const readiness = kernelReadiness.getStatus();
    sendJson(response, readiness.ready ? 200 : 503, readiness);
    return;
  }
  if (pathname === '/api/v1/status') {
    sendJson(response, 200, kernelReadiness.getStatus());
    return;
  }
  if (pathname === '/api/v1/product') {
    sendJson(response, 200, {
      schema_version: productManifest.schema_version,
      id: productManifest.id,
      display_name: productManifest.display_name,
      features: productManifest.features,
      surface_websocket: '/api/v1/surface',
    });
    return;
  }
  sendJson(response, 404, { error: 'not_found' });
}

function proxySurfaceConnection(client: WebSocket, endpoint: string): void {
  const upstream = new WebSocket(endpoint);
  const pending: Array<{ data: RawData; binary: boolean }> = [];
  client.on('message', (data, binary) => {
    const blockedRequestId = remoteFileInstallRequestId(data, binary);
    if (blockedRequestId) {
      client.send(JSON.stringify({
        kind: 'extension_install_preview',
        timestamp: Date.now(),
        extension_install_preview: {
          request_id: blockedRequestId,
          status: 'error',
          message: 'Personal Server 不接受服务器文件路径；请使用 Registry、仓库 Release 或 Release Manifest。',
        },
      }));
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, binary });
  });
  upstream.on('open', () => {
    for (const item of pending.splice(0)) upstream.send(item.data, { binary: item.binary });
  });
  upstream.on('message', (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  const closePeer = (peer: WebSocket) => {
    if (peer.readyState === WebSocket.OPEN || peer.readyState === WebSocket.CONNECTING) peer.close();
  };
  client.on('close', () => closePeer(upstream));
  upstream.on('close', () => closePeer(client));
  client.on('error', () => closePeer(upstream));
  upstream.on('error', () => closePeer(client));
}

function remoteFileInstallRequestId(data: RawData, binary: boolean): string | null {
  if (binary) return null;
  try {
    const frame = JSON.parse(data.toString()) as Record<string, unknown>;
    if (frame.kind !== 'extension_install_prepare') return null;
    const request = frame.extension_install_prepare as Record<string, unknown> | undefined;
    const source = request?.source as Record<string, unknown> | undefined;
    if (source?.kind !== 'file') return null;
    return typeof request?.request_id === 'string' && request.request_id
      ? request.request_id
      : `extension-install-rejected-${Date.now()}`;
  } catch {
    return null;
  }
}

async function resolveControlSurfaceEndpoint(): Promise<string | null> {
  try {
    const catalog = JSON.parse(await readFile(endpointCatalogPath, 'utf8')) as EndpointCatalog;
    return catalog.endpoints.find((item) => item.purpose === 'control-surface')?.endpoint || null;
  } catch {
    return null;
  }
}

function isLoopback(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

function findApplicationRoot(seed: string): string {
  let current = path.resolve(seed);
  while (true) {
    if (existsSync(path.join(current, 'products', 'personal-server', 'product.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(seed);
    current = parent;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  applySecurityHeaders(response);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

async function handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { error: 'origin_rejected' });
    return;
  }
  const clientId = requestClientId(request);
  if (sessions.isRateLimited(clientId)) {
    response.setHeader('retry-after', '60');
    sendJson(response, 429, { error: 'rate_limited' });
    return;
  }
  try {
    const body = await readJsonBody(request, 4096);
    const suppliedToken = typeof body.token === 'string' ? body.token : '';
    const session = sessions.login(suppliedToken, clientId);
    if (!session) {
      sendJson(response, 401, { error: 'invalid_token' });
      return;
    }
    response.setHeader('set-cookie', sessions.sessionCookie(session.sessionId, request));
    sendJson(response, 200, { authenticated: true, expires_at: session.expiresAt });
  } catch {
    sendJson(response, 400, { error: 'invalid_request' });
  }
}

async function readJsonBody(
  incoming: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request_body_must_be_object');
  }
  return parsed as Record<string, unknown>;
}

async function serveWebAsset(pathname: string, response: ServerResponse): Promise<void> {
  const asset = pathname === '/' ? 'index.html'
    : pathname === '/assets/app.css' ? 'app.css'
      : 'app.js';
  try {
    const body = await readFile(path.join(publicRoot, asset));
    applySecurityHeaders(response);
    response.writeHead(200, {
      'content-type': asset.endsWith('.html') ? 'text/html; charset=utf-8'
        : asset.endsWith('.css') ? 'text/css; charset=utf-8'
          : 'text/javascript; charset=utf-8',
      'cache-control': asset === 'index.html' ? 'no-store' : 'public, max-age=3600',
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: 'asset_not_found' });
  }
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

async function stop(): Promise<void> {
  stopPromise ??= stopServer();
  return stopPromise;
}

async function stopServer(): Promise<void> {
  kernelReadiness.stop();
  for (const client of websocketServer.clients) client.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exitCode = 0;
}
