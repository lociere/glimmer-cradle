import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { WebSocketServer } from 'ws';
import { KernelReadinessMonitor } from '../websocket/kernel-readiness-monitor';
import { loadPersonalServerProductManifest } from '../adapters/product-manifest';
import { ProductAuditLog } from '../adapters/audit-log';
import {
  LocalExtensionUploadStore,
  type LocalExtensionUploadAuthorization,
} from '../adapters/local-extension-upload-store';
import {
  DeploymentOperationsService,
  type DeploymentOperationResult,
} from '../adapters/deployment-operations-service';
import { readEndpointCatalogEntry } from '../adapters/endpoint-catalog';
import { ObservabilityLogService, type ObservabilityLogQuery } from '../adapters/observability-log-service';
import {
  AccessTokenStore,
  type AccessTokenMutationResult,
  type AccessTokenSnapshot,
} from '../auth/access-token-store';
import { isSameOrigin, requestClientId, SessionManager } from '../auth/session-manager';
import { readBinaryBody, readJsonBody, sendJson } from '../http/json';
import { openEventStream, sendEventStreamPayload } from '../http/event-stream';
import { serveBuiltWebAsset } from '../http/static-assets';
import { proxySurfaceConnection } from '../websocket/surface-proxy';
import { findPersonalServerPackageRoot } from './package-root';

const MAX_LOCAL_EXTENSION_UPLOAD_BYTES = 256 * 1024 * 1024;
const LOCAL_EXTENSION_UPLOAD_RETENTION_MS = 30 * 60 * 1000;

export interface PersonalServerAppOptions {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly productManifestPath?: string;
  readonly cwd?: string;
}

export class PersonalServerApp {
  private readonly packageRoot: string;
  private readonly productManifest;
  private readonly dataRoot: string;
  private readonly configRoot: string;
  private readonly applicationRoot: string;
  private readonly endpointCatalogPath: string;
  private readonly extensionUploadRoot: string;
  private readonly localExtensionUploads: LocalExtensionUploadStore;
  private readonly publicRoot: string;
  private readonly observabilityLogs;
  private readonly auditLog;
  private readonly accessTokens: AccessTokenStore;
  private readonly operations: DeploymentOperationsService;
  private readonly sessions: SessionManager;
  private readonly kernelReadiness: KernelReadinessMonitor;
  private readonly server;
  private readonly websocketServer;
  private readonly connections = new Set<Socket>();
  private stopPromise: Promise<void> | null = null;

  public constructor(private readonly options: PersonalServerAppOptions) {
    this.packageRoot = findPersonalServerPackageRoot(
      options.productManifestPath ? path.dirname(options.productManifestPath) : options.cwd || process.cwd(),
    );
    this.applicationRoot = path.resolve(this.packageRoot, '..', '..');
    this.productManifest = loadPersonalServerProductManifest(
      options.productManifestPath || path.join(this.packageRoot, 'product.json'),
    );
    this.dataRoot = path.resolve(normalizeOptionalPathEnv(process.env.GLIMMER_CRADLE_DATA_ROOT) || path.join(this.applicationRoot, 'data'));
    this.configRoot = path.resolve(normalizeOptionalPathEnv(process.env.GLIMMER_CRADLE_CONFIG_ROOT) || path.join(this.applicationRoot, 'configs'));
    const runRoot = path.resolve(normalizeOptionalPathEnv(process.env.GLIMMER_CRADLE_RUN_ROOT) || path.join(this.dataRoot, 'run'));
    this.endpointCatalogPath = path.join(runRoot, 'host', 'endpoints.json');
    this.extensionUploadRoot = path.join(this.dataRoot, 'state', 'personal-server', 'extension-uploads');
    this.localExtensionUploads = new LocalExtensionUploadStore(this.extensionUploadRoot, {
      retentionMs: LOCAL_EXTENSION_UPLOAD_RETENTION_MS,
    });
    this.publicRoot = path.join(this.packageRoot, 'dist', 'public');
    this.observabilityLogs = new ObservabilityLogService(path.join(this.dataRoot, 'observability'));
    this.auditLog = new ProductAuditLog(path.join(this.dataRoot, 'observability'));
    this.operations = new DeploymentOperationsService({
      applicationRoot: this.applicationRoot,
      packageRoot: this.packageRoot,
      cliPath: normalizeOptionalPathEnv(process.env.GLIMMER_CRADLE_CLI_PATH) || undefined,
      deploymentEnvFile: process.env.GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE,
      releaseSource: process.env.GLIMMER_CRADLE_RELEASE_SOURCE,
    });
    this.accessTokens = new AccessTokenStore({
      configRoot: this.configRoot,
      loopbackOnly: isLoopback(this.options.host),
      legacyToken: options.token,
    });
    this.sessions = new SessionManager(this.accessTokens);
    this.server = createServer((request, response) => void this.handleRequest(request, response));
    this.server.on('connection', (socket) => {
      this.connections.add(socket);
      socket.once('close', () => {
        this.connections.delete(socket);
      });
    });
    this.websocketServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
    this.kernelReadiness = new KernelReadinessMonitor(
      async () => readEndpointCatalogEntry(this.endpointCatalogPath, 'control-surface'),
      500,
      () => void this.stop(),
    );
  }

  public async start(): Promise<void> {
    if (!Number.isInteger(this.options.port) || this.options.port < 0 || this.options.port > 65535) {
      throw new Error(`GLIMMER_CRADLE_SERVER_PORT 无效: ${process.env.GLIMMER_CRADLE_SERVER_PORT}`);
    }
    if (!isLoopback(this.options.host) && !this.options.token) {
      throw new Error('Personal Server 绑定非回环地址时必须配置 GLIMMER_CRADLE_SERVER_TOKEN');
    }

    this.kernelReadiness.start();
    this.server.on('upgrade', async (request, socket, head) => {
      if (request.url?.split('?')[0] !== '/api/v1/surface') {
        socket.destroy();
        return;
      }
      const authorization = !isSameOrigin(request)
        ? null
        : await this.sessions.authorize(request, 'surface:write');
      if (!authorization) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const endpoint = await readEndpointCatalogEntry(this.endpointCatalogPath, 'control-surface');
      if (!endpoint) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.websocketServer.handleUpgrade(request, socket, head, (client) => {
        proxySurfaceConnection(client, endpoint, {
          extensionUploadAuthorization: toUploadAuthorization(authorization),
          localExtensionUploads: this.localExtensionUploads,
        });
      });
    });

    await this.localExtensionUploads.initialize();
    await new Promise<void>((resolve) => {
      this.server.listen(this.options.port, this.options.host, () => resolve());
    });
  }

  public stop(): Promise<void> {
    this.stopPromise ??= this.stopServer();
    return this.stopPromise;
  }

  private async stopServer(): Promise<void> {
    this.kernelReadiness.stop();
    for (const client of this.websocketServer.clients) client.close();
    const closePromise = new Promise<void>((resolve) => this.server.close(() => resolve()));
    if (typeof this.server.closeIdleConnections === 'function') {
      this.server.closeIdleConnections();
    }
    for (const socket of this.connections) {
      socket.destroy();
    }
    await closePromise;
    process.exitCode = 0;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = request.url?.split('?')[0] || '/';
    if (pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok', product: this.productManifest.id });
      return;
    }
    if (pathname === '/api/v1/session' && request.method === 'GET') {
      sendJson(response, 200, { authenticated: await this.sessions.authenticate(request) });
      return;
    }
    if (pathname === '/api/v1/session' && request.method === 'POST') {
      await this.handleLogin(request, response);
      return;
    }
    if (pathname === '/api/v1/session' && request.method === 'DELETE') {
      this.sessions.logout(request);
      response.setHeader('set-cookie', this.sessions.clearCookie(request));
      sendJson(response, 200, { authenticated: false });
      return;
    }
    if (await serveBuiltWebAsset(pathname, this.publicRoot, response)) {
      return;
    }
    if (!await this.sessions.authenticate(request)) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    if (pathname === '/readyz') {
      const readiness = this.kernelReadiness.getStatus();
      sendJson(response, readiness.ready ? 200 : 503, readiness);
      return;
    }
    if (pathname === '/api/v1/status') {
      sendJson(response, 200, this.kernelReadiness.getStatus());
      return;
    }
    if (pathname === '/api/v1/product') {
      sendJson(response, 200, {
        schema_version: this.productManifest.schema_version,
        id: this.productManifest.id,
        display_name: this.productManifest.display_name,
        features: this.productManifest.features,
        surface_websocket: '/api/v1/surface',
      });
      return;
    }
    if (pathname === '/api/v1/security/access-tokens' && request.method === 'GET') {
      await this.handleAccessTokenSnapshot(request, response);
      return;
    }
    if (pathname === '/api/v1/security/access-tokens' && request.method === 'POST') {
      await this.handleAccessTokenMutation(request, response);
      return;
    }
    if (pathname === '/api/v1/operations' && request.method === 'GET') {
      await this.handleOperationsSnapshot(request, response);
      return;
    }
    if (pathname === '/api/v1/operations' && request.method === 'POST') {
      await this.handleOperationsRequest(request, response);
      return;
    }
    if (pathname === '/api/v1/extensions/local-package' && request.method === 'POST') {
      await this.handleLocalExtensionUpload(request, response);
      return;
    }
    if (pathname === '/api/v1/logs/recent') {
      await this.handleRecentLogs(request, response);
      return;
    }
    if (pathname === '/api/v1/logs/stream') {
      this.handleLogStream(request, response);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
  }

  private async handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: 'origin_rejected' });
      return;
    }
    const clientId = requestClientId(request);
    if (this.sessions.isRateLimited(clientId)) {
      response.setHeader('retry-after', '60');
      sendJson(response, 429, { error: 'rate_limited' });
      return;
    }
    try {
      const body = await readJsonBody(request, 4096);
      const suppliedToken = typeof body.token === 'string' ? body.token : '';
      const session = await this.sessions.login(suppliedToken, clientId);
      if (!session) {
        sendJson(response, 401, { error: 'invalid_token' });
        return;
      }
      response.setHeader('set-cookie', this.sessions.sessionCookie(session.sessionId, request));
      sendJson(response, 200, { authenticated: true, expires_at: session.expiresAt });
    } catch {
      sendJson(response, 400, { error: 'invalid_request' });
    }
  }

  private async handleAccessTokenSnapshot(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorized = await this.sessions.authenticate(request, 'tokens:write');
    if (!authorized) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    const snapshot = await this.accessTokens.getSnapshot();
    sendJson(response, 200, snapshot);
  }

  private async handleAccessTokenMutation(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorized = await this.sessions.authenticate(request, 'tokens:write');
    if (!authorized) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: 'origin_rejected' });
      return;
    }
    try {
      const body = await readJsonBody(request, 8192) as {
        operation?: string;
        label?: string;
        token_id?: string;
      };
      let result: AccessTokenMutationResult;
      if (body.operation === 'create') {
        result = await this.accessTokens.createToken(String(body.label || ''));
      } else if (body.operation === 'rotate') {
        result = await this.accessTokens.rotateToken(String(body.token_id || ''));
      } else if (body.operation === 'revoke') {
        result = await this.accessTokens.revokeToken(String(body.token_id || ''));
      } else {
        sendJson(response, 400, { error: 'invalid_operation' });
        return;
      }
      await this.auditLog.append({
        owner: 'personal_server',
        module: 'access-token-api',
        action: `access_token.${String(body.operation)}`,
        target_kind: 'access_token',
        target_name: typeof body.token_id === 'string' ? body.token_id : result.issued_token_id,
        outcome: result.status === 'success' ? 'succeeded' : 'failed',
        reason: result.status === 'success' ? null : result.message,
        attributes: {
          issued_token_id: result.issued_token_id ?? null,
        },
      }).catch(() => undefined);
      sendJson(response, result.status === 'success' ? 200 : 400, result);
    } catch {
      sendJson(response, 400, { error: 'invalid_request' });
    }
  }

  private async handleOperationsSnapshot(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorized = await this.sessions.authenticate(request, 'operations:write');
    if (!authorized) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    sendJson(response, 200, await this.operations.getSnapshot());
  }

  private async handleOperationsRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorized = await this.sessions.authenticate(request, 'operations:write');
    if (!authorized) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: 'origin_rejected' });
      return;
    }
    try {
      const body = await readJsonBody(request, 8192) as {
        operation?: string;
        backup_id?: string;
        confirm?: boolean;
      };
      const result = await this.operations.execute(body);
      await this.auditOperationsResult(body.operation || 'unknown', body.backup_id || null, result);
      sendJson(response, result.status === 'error'
        ? 400
        : result.status === 'conflict'
          ? 409
          : 200, result);
    } catch {
      sendJson(response, 400, { error: 'invalid_request' });
    }
  }

  private async handleLocalExtensionUpload(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authorization = await this.sessions.authorize(request, 'surface:write');
    if (!authorization) {
      sendJson(response, 403, { error: 'forbidden' });
      return;
    }
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: 'origin_rejected' });
      return;
    }

    const fileName = sanitizeLocalExtensionFileName(request.headers['x-glimmer-file-name']);
    if (!fileName) {
      sendJson(response, 400, { error: 'invalid_file_name' });
      return;
    }
    if (path.extname(fileName).toLowerCase() !== '.gcex') {
      sendJson(response, 400, { error: 'invalid_extension_package' });
      return;
    }

    try {
      const body = await readBinaryBody(request, MAX_LOCAL_EXTENSION_UPLOAD_BYTES);
      if (body.byteLength === 0) {
        sendJson(response, 400, { error: 'empty_upload' });
        return;
      }
      const stored = await this.localExtensionUploads.storeUpload(
        fileName,
        body,
        toUploadAuthorization(authorization),
      );
      await this.auditLog.append({
        owner: 'personal_server',
        module: 'extensions-upload-api',
        action: 'extension.upload_local_package',
        target_kind: 'extension_package',
        target_name: fileName,
        outcome: 'succeeded',
        attributes: {
          upload_id: stored.upload_id,
          size_bytes: body.byteLength,
        },
      }).catch(() => undefined);
      sendJson(response, 200, stored);
    } catch (error) {
      if (error instanceof Error && error.message === 'request_too_large') {
        sendJson(response, 413, { error: 'request_too_large' });
        return;
      }
      sendJson(response, 400, { error: 'invalid_request' });
    }
  }

  private async handleRecentLogs(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const query = this.readLogQuery(request);
    const entries = await this.observabilityLogs.listRecentEntries(query);
    sendJson(response, 200, { entries });
  }

  private handleLogStream(request: IncomingMessage, response: ServerResponse): void {
    const query = this.readLogQuery(request);
    const heartbeat = setInterval(() => {
      response.write(': keep-alive\n\n');
    }, 15000);
    heartbeat.unref();

    let disposed = false;
    let cursor = this.observabilityLogs.createCursor();
    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      clearInterval(poller);
      response.end();
    };

    openEventStream(response);
    const poller = setInterval(() => {
      void this.observabilityLogs.readIncrementalEntries(cursor, query)
        .then((result) => {
          cursor = result.cursor;
          for (const entry of result.entries) {
            sendEventStreamPayload(response, 'log-entry', entry);
          }
        })
        .catch(() => undefined);
    }, 1000);
    poller.unref();

    void this.observabilityLogs.readIncrementalEntries(cursor, query)
      .then((result) => { cursor = result.cursor; })
      .catch(() => undefined);

    request.once('close', cleanup);
    response.once('close', cleanup);
  }

  private readLogQuery(request: IncomingMessage): ObservabilityLogQuery {
    const limitValue = Number.parseInt(readQueryValue(request, 'limit'), 10);
    return {
      level: readQueryValue(request, 'level'),
      module: readQueryValue(request, 'module'),
      trace_id: readQueryValue(request, 'trace_id'),
      limit: Number.isFinite(limitValue) ? limitValue : undefined,
    };
  }

  private async auditOperationsResult(
    operation: string,
    targetName: string | null,
    result: DeploymentOperationResult,
  ): Promise<void> {
    await this.auditLog.append({
      owner: 'personal_server',
      module: 'operations-api',
      action: `operations.${operation}`,
      target_kind: 'deployment_operation',
      target_name: targetName,
      outcome: result.status === 'error'
        || result.status === 'conflict'
        ? 'failed'
        : result.status === 'accepted'
          ? 'accepted'
          : 'succeeded',
      reason: result.status === 'error' || result.status === 'conflict' ? result.message : null,
      attributes: result.operation_id ? { operation_id: result.operation_id } : undefined,
    }).catch(() => undefined);
  }
}

function isLoopback(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

function normalizeOptionalPathEnv(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === 'undefined' || normalized.toLowerCase() === 'null') return null;
  return normalized;
}

function sanitizeLocalExtensionFileName(headerValue: string | string[] | undefined): string {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== 'string') return '';
  const normalized = raw.trim().replaceAll('\\', '/');
  const baseName = path.posix.basename(normalized);
  return baseName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function readQueryValue(request: IncomingMessage, name: string): string {
  const origin = `http://${request.headers.host || '127.0.0.1'}`;
  const url = new URL(request.url || '/', origin);
  return url.searchParams.get(name)?.trim() || '';
}

function toUploadAuthorization(session: {
  principal: { token_id: string };
  sessionBinding: string;
}): LocalExtensionUploadAuthorization {
  return {
    principalId: session.principal.token_id,
    sessionBinding: session.sessionBinding,
  };
}
