import type {
  ConversationHistoryRequest,
  ConversationHistoryResult,
  ConfigurationSnapshot,
  ConfigurationSnapshotResult,
  ConfigurationTestRequest,
  ConfigurationTestResult,
  ConfigurationUpdateRequest,
  ConfigurationUpdateResult,
  ExtensionInstallCommitRequest,
  ExtensionInstallPreview,
  ExtensionInstallPrepareRequest,
  ExtensionInstallResult,
  ExtensionLifecycleRequest,
  ExtensionLifecycleResult,
  ExtensionRuntimeProjection,
  ExtensionRuntimeProjectionRequest,
  ExtensionRuntimeProjectionResult,
  ExtensionUninstallRequest,
  ExtensionUninstallResult,
  PresentationDownstreamFrame,
  PresentationUpstreamFrame,
  PresentationRuntimeReadinessSnapshot,
} from '@glimmer-cradle/protocol';

export interface ProductProjection {
  readonly display_name: string;
  readonly features: {
    readonly extensions?: boolean;
    readonly audio?: { readonly tts?: boolean; readonly asr?: boolean };
  };
}

export interface RuntimeProjection extends PresentationRuntimeReadinessSnapshot {}
export type ExtensionRuntimeState = ExtensionRuntimeProjection;

export interface ReadinessStatus {
  readonly ready: boolean;
  readonly status: 'starting' | 'ready' | 'failed';
  readonly summary: string;
  readonly connection_state: 'disconnected' | 'connecting' | 'observing';
  readonly observed_at?: number;
  readonly connection_error?: string;
  readonly blocking_runtimes: ReadonlyArray<{ runtime_id: string; state: string; summary: string }>;
}

export type SurfaceFrame = PresentationDownstreamFrame;

export interface ObservabilityLogQuery {
  readonly level?: string;
  readonly module?: string;
  readonly trace_id?: string;
  readonly limit?: number;
}

export interface ObservabilityLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly source: 'event' | 'audit' | 'application';
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly module: string;
  readonly owner: string;
  readonly runtime_id: string;
  readonly trace_id: string;
  readonly event_type: string;
  readonly message: string;
  readonly summary?: string;
  readonly raw: string;
}

export interface AccessTokenSnapshotItem {
  readonly token_id: string;
  readonly label: string;
  readonly scopes: ReadonlyArray<'surface:read' | 'surface:write' | 'tokens:write' | 'operations:write'>;
  readonly source: 'managed' | 'legacy_env' | 'open_local';
  readonly managed: boolean;
  readonly rotatable: boolean;
  readonly revocable: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at?: string;
  readonly disabled_reason?: string;
}

export interface AccessTokenSnapshot {
  readonly mode: 'managed' | 'legacy_env' | 'open_local';
  readonly degraded: boolean;
  readonly message: string;
  readonly tokens: ReadonlyArray<AccessTokenSnapshotItem>;
}

export interface AccessTokenMutationResult {
  readonly status: 'success' | 'error';
  readonly message: string;
  readonly snapshot: AccessTokenSnapshot;
  readonly issued_token?: string;
  readonly issued_token_id?: string;
}

export interface DeploymentBackupEntry {
  readonly backup_id: string;
  readonly created_at: string;
  readonly status: string;
}

export interface DeploymentOperationsSnapshot {
  readonly backup: {
    readonly supported: boolean;
    readonly disabled_reason?: string;
    readonly backup_root?: string;
    readonly entries: ReadonlyArray<DeploymentBackupEntry>;
  };
  readonly service: {
    readonly restart_supported: boolean;
    readonly stop_supported: boolean;
    readonly disabled_reason?: string;
  };
  readonly update: {
    readonly check_supported: boolean;
    readonly apply_supported: boolean;
    readonly current_version: string;
    readonly source: string;
    readonly disabled_reason?: string;
    readonly available_version?: string;
  };
}

export interface DeploymentOperationResult {
  readonly status: 'success' | 'error' | 'accepted' | 'disabled' | 'preflight' | 'conflict';
  readonly message: string;
  readonly snapshot: DeploymentOperationsSnapshot;
  readonly requires_confirmation?: boolean;
  readonly operation_id?: string;
}

type SkillCatalogRequest = NonNullable<PresentationUpstreamFrame['skill_catalog_request']>;
export type SkillCatalogLoadResult = NonNullable<PresentationDownstreamFrame['skill_catalog_response']>;
export interface LocalExtensionUploadResult {
  readonly upload_id: string;
  readonly file_name: string;
  readonly size: number;
  readonly expires_at: string;
}

export class PersonalServerClient {
  public async getSession(): Promise<{ authenticated: boolean }> {
    const response = await fetch('/api/v1/session', { cache: 'no-store' });
    return response.json();
  }

  public async login(token: string): Promise<Response> {
    return fetch('/api/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }

  public async logout(): Promise<void> {
    await fetch('/api/v1/session', { method: 'DELETE' });
  }

  public async getProduct(): Promise<ProductProjection> {
    const response = await fetch('/api/v1/product', { cache: 'no-store' });
    if (!response.ok) throw new Error(`product_${response.status}`);
    return response.json();
  }

  public async getStatus(): Promise<ReadinessStatus> {
    const response = await fetch('/api/v1/status', { cache: 'no-store' });
    if (response.status === 401) throw new Error('unauthorized');
    if (!response.ok) throw new Error(`status_${response.status}`);
    return response.json();
  }

  public async getRecentLogs(query: ObservabilityLogQuery = {}): Promise<ReadonlyArray<ObservabilityLogEntry>> {
    const response = await fetch(`/api/v1/logs/recent${toQueryString(query)}`, { cache: 'no-store' });
    if (response.status === 401) throw new Error('unauthorized');
    if (!response.ok) throw new Error(`logs_${response.status}`);
    const payload = await response.json() as { entries?: ObservabilityLogEntry[] };
    return payload.entries ?? [];
  }

  public connectLogStream(
    query: ObservabilityLogQuery,
    handlers: {
      readonly onEntry: (entry: ObservabilityLogEntry) => void;
      readonly onError: () => void;
    },
  ): PersonalServerLogStream {
    return new PersonalServerLogStream(`/api/v1/logs/stream${toQueryString(query)}`, handlers);
  }

  public connectSurface(handlers: {
    readonly onOpen: () => void;
    readonly onFrame: (frame: SurfaceFrame) => void;
    readonly onClose: () => void;
  }): PersonalServerSurface {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/api/v1/surface`);
    return new PersonalServerSurface(socket, handlers);
  }

  public async getAccessTokenSnapshot(): Promise<AccessTokenSnapshot> {
    const response = await fetch('/api/v1/security/access-tokens', { cache: 'no-store' });
    if (response.status === 401) throw new Error('unauthorized');
    if (response.status === 403) throw new Error('forbidden');
    if (!response.ok) throw new Error(`access_tokens_${response.status}`);
    return response.json();
  }

  public async createAccessToken(label: string): Promise<AccessTokenMutationResult> {
    return this.mutateAccessToken({ operation: 'create', label });
  }

  public async rotateAccessToken(tokenId: string): Promise<AccessTokenMutationResult> {
    return this.mutateAccessToken({ operation: 'rotate', token_id: tokenId });
  }

  public async revokeAccessToken(tokenId: string): Promise<AccessTokenMutationResult> {
    return this.mutateAccessToken({ operation: 'revoke', token_id: tokenId });
  }

  public async getOperationsSnapshot(): Promise<DeploymentOperationsSnapshot> {
    const response = await fetch('/api/v1/operations', { cache: 'no-store' });
    if (response.status === 401) throw new Error('unauthorized');
    if (response.status === 403) throw new Error('forbidden');
    if (!response.ok) throw new Error(`operations_${response.status}`);
    return response.json();
  }

  public async runOperation(
    operation: string,
    options: { readonly backupId?: string; readonly confirm?: boolean } = {},
  ): Promise<DeploymentOperationResult> {
    const response = await fetch('/api/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation,
        backup_id: options.backupId,
        confirm: options.confirm,
      }),
    });
    if (response.status === 401) throw new Error('unauthorized');
    if (response.status === 403) throw new Error('forbidden');
    const payload = await response.json() as DeploymentOperationResult | { error?: string };
    if (!response.ok) {
      throw new Error('message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `operations_${response.status}`);
    }
    return payload as DeploymentOperationResult;
  }

  public async uploadLocalExtensionPackage(file: File): Promise<LocalExtensionUploadResult> {
    const response = await fetch('/api/v1/extensions/local-package', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-glimmer-file-name': file.name,
      },
      body: await file.arrayBuffer(),
    });
    if (response.status === 401) throw new Error('unauthorized');
    if (response.status === 403) throw new Error('forbidden');
    const payload = await response.json() as LocalExtensionUploadResult | { error?: string };
    if (!response.ok) {
      throw new Error('error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `local_extension_upload_${response.status}`);
    }
    return payload as LocalExtensionUploadResult;
  }

  private async mutateAccessToken(body: Record<string, unknown>): Promise<AccessTokenMutationResult> {
    const response = await fetch('/api/v1/security/access-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) throw new Error('unauthorized');
    if (response.status === 403) throw new Error('forbidden');
    const payload = await response.json() as AccessTokenMutationResult | { error?: string };
    if (!response.ok) {
      throw new Error('message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `access_token_mutation_${response.status}`);
    }
    return payload as AccessTokenMutationResult;
  }
}

export class PersonalServerLogStream {
  private readonly source: EventSource;

  public constructor(
    url: string,
    handlers: {
      readonly onEntry: (entry: ObservabilityLogEntry) => void;
      readonly onError: () => void;
    },
  ) {
    this.source = new EventSource(url);
    this.source.addEventListener('log-entry', (event) => {
      try {
        handlers.onEntry(JSON.parse((event as MessageEvent).data) as ObservabilityLogEntry);
      } catch {
        // Ignore malformed log stream payloads at the network boundary.
      }
    });
    this.source.onerror = () => {
      handlers.onError();
    };
  }

  public close(): void {
    this.source.close();
  }
}

export class PersonalServerSurface {
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  public constructor(
    private readonly socket: WebSocket,
    private readonly handlers: {
      readonly onOpen: () => void;
      readonly onFrame: (frame: SurfaceFrame) => void;
      readonly onClose: () => void;
    },
  ) {
    socket.addEventListener('open', handlers.onOpen);
    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as SurfaceFrame;
        this.resolvePending(frame);
        handlers.onFrame(frame);
      } catch {
        // Ignore malformed frames from the network boundary.
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('surface_closed'));
      }
      this.pending.clear();
      handlers.onClose();
    });
    socket.addEventListener('error', () => socket.close());
  }

  public get readyState(): number {
    return this.socket.readyState;
  }

  public close(): void {
    this.socket.close();
  }

  public sendChatInput(text: string, traceId?: string): void {
    this.socket.send(JSON.stringify({
      kind: 'chat_input',
      trace_id: traceId,
      timestamp: Date.now(),
      chat_input: { text },
    }));
  }

  public async requestConversationHistory(
    request: ConversationHistoryRequest,
  ): Promise<ConversationHistoryResult> {
    return this.sendRequest<ConversationHistoryResult>(
      {
        kind: 'conversation_history_request',
        timestamp: Date.now(),
        conversation_history_request: request,
      },
      request.request_id,
      'conversation_history_result',
    );
  }

  public async requestConfigurationSnapshot(): Promise<ConfigurationSnapshot> {
    const requestId = createRequestId('config-snapshot');
    const result = await this.sendRequest<ConfigurationSnapshotResult>(
      {
        kind: 'config_snapshot_request',
        timestamp: Date.now(),
        config_snapshot_request: { request_id: requestId },
      },
      requestId,
      'configuration_snapshot_result',
    );
    if (result.status !== 'success' || !result.snapshot) {
      throw new Error(result.message || '配置快照读取失败');
    }
    return result.snapshot;
  }

  public async previewConfigurationUpdate(
    request: ConfigurationUpdateRequest,
  ): Promise<ConfigurationUpdateResult> {
    return this.sendConfigurationUpdate({ ...request, dry_run: true });
  }

  public async applyConfigurationUpdate(
    request: ConfigurationUpdateRequest,
  ): Promise<ConfigurationUpdateResult> {
    return this.sendConfigurationUpdate({ ...request, dry_run: false });
  }

  public async testProvider(
    request: ConfigurationTestRequest,
  ): Promise<ConfigurationTestResult> {
    return this.sendRequest<ConfigurationTestResult>(
      {
        kind: 'config_test_request',
        timestamp: Date.now(),
        config_test_request: request,
      },
      request.request_id,
      'configuration_test_result',
    );
  }

  public async requestExtensionRuntimeProjection(
    request: ExtensionRuntimeProjectionRequest,
  ): Promise<ExtensionRuntimeProjectionResult> {
    return this.sendRequest<ExtensionRuntimeProjectionResult>(
      {
        kind: 'extension_runtime_projection_request',
        timestamp: Date.now(),
        extension_runtime_projection_request: request,
      },
      request.request_id,
      'extension_runtime_projection_result',
    );
  }

  public async prepareExtensionInstall(
    request: ExtensionInstallPrepareRequest,
  ): Promise<ExtensionInstallPreview> {
    return this.sendRequest<ExtensionInstallPreview>(
      {
        kind: 'extension_install_prepare',
        timestamp: Date.now(),
        extension_install_prepare: request,
      },
      request.request_id,
      'extension_install_preview',
    );
  }

  public async commitExtensionInstall(
    request: ExtensionInstallCommitRequest,
  ): Promise<ExtensionInstallResult> {
    return this.sendRequest<ExtensionInstallResult>(
      {
        kind: 'extension_install_commit',
        timestamp: Date.now(),
        extension_install_commit: request,
      },
      request.request_id,
      'extension_install_result',
    );
  }

  public async cancelExtensionInstall(
    requestId: string,
    transactionId: string,
  ): Promise<ExtensionInstallResult> {
    return this.sendRequest<ExtensionInstallResult>(
      {
        kind: 'extension_install_cancel',
        timestamp: Date.now(),
        extension_install_cancel: {
          request_id: requestId,
          transaction_id: transactionId,
        },
      },
      requestId,
      'extension_install_result',
    );
  }

  public async requestExtensionLifecycle(
    request: ExtensionLifecycleRequest,
  ): Promise<ExtensionLifecycleResult> {
    return this.sendRequest<ExtensionLifecycleResult>(
      {
        kind: 'extension_lifecycle_request',
        timestamp: Date.now(),
        extension_lifecycle_request: request,
      },
      request.request_id,
      'extension_lifecycle_result',
    );
  }

  public async uninstallExtension(
    request: ExtensionUninstallRequest,
  ): Promise<ExtensionUninstallResult> {
    return this.sendRequest<ExtensionUninstallResult>(
      {
        kind: 'extension_uninstall_request',
        timestamp: Date.now(),
        extension_uninstall_request: request,
      },
      request.request_id,
      'extension_uninstall_result',
    );
  }

  public async requestSkillCatalog(
    request: SkillCatalogRequest,
  ): Promise<SkillCatalogLoadResult> {
    return this.sendRequest<SkillCatalogLoadResult>(
      {
        kind: 'skill_catalog_request',
        timestamp: Date.now(),
        skill_catalog_request: request,
      },
      request.request_id,
      'skill_catalog_response',
    );
  }

  private async sendConfigurationUpdate(
    request: ConfigurationUpdateRequest,
  ): Promise<ConfigurationUpdateResult> {
    return this.sendRequest<ConfigurationUpdateResult>(
      {
        kind: 'config_update_request',
        timestamp: Date.now(),
        config_update_request: request,
      },
      request.request_id,
      'configuration_update_result',
    );
  }

  private sendRequest<TResult extends { request_id: string }>(
    frame: Record<string, unknown>,
    requestId: string,
    expectedKind: SurfaceFrame['kind'],
  ): Promise<TResult> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('surface_unavailable'));
    }
    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('surface_timeout'));
      }, 30000);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.socket.send(JSON.stringify(frame));
    }).then((result) => {
      if (!result || typeof result !== 'object') {
        throw new Error(`unexpected_${expectedKind}`);
      }
      return result;
    });
  }

  private resolvePending(frame: SurfaceFrame): void {
    const payload = extractRequestPayload(frame);
    if (!payload) return;
    const pending = this.pending.get(payload.requestId);
    if (!pending) return;
    this.pending.delete(payload.requestId);
    clearTimeout(pending.timeout);
    pending.resolve(payload.body);
  }
}

function extractRequestPayload(frame: SurfaceFrame): { requestId: string; body: unknown } | null {
  if (frame.configuration_snapshot_result?.request_id) {
    return { requestId: frame.configuration_snapshot_result.request_id, body: frame.configuration_snapshot_result };
  }
  if (frame.conversation_history_result?.request_id) {
    return { requestId: frame.conversation_history_result.request_id, body: frame.conversation_history_result };
  }
  if (frame.configuration_update_result?.request_id) {
    return { requestId: frame.configuration_update_result.request_id, body: frame.configuration_update_result };
  }
  if (frame.configuration_test_result?.request_id) {
    return { requestId: frame.configuration_test_result.request_id, body: frame.configuration_test_result };
  }
  if (frame.extension_runtime_projection_result?.request_id) {
    return { requestId: frame.extension_runtime_projection_result.request_id, body: frame.extension_runtime_projection_result };
  }
  if (frame.skill_catalog_response?.request_id) {
    return { requestId: frame.skill_catalog_response.request_id, body: frame.skill_catalog_response };
  }
  if (frame.extension_install_preview?.request_id) {
    return { requestId: frame.extension_install_preview.request_id, body: frame.extension_install_preview };
  }
  if (frame.extension_install_result?.request_id) {
    return { requestId: frame.extension_install_result.request_id, body: frame.extension_install_result };
  }
  if (frame.extension_lifecycle_result?.request_id) {
    return { requestId: frame.extension_lifecycle_result.request_id, body: frame.extension_lifecycle_result };
  }
  if (frame.extension_uninstall_result?.request_id) {
    return { requestId: frame.extension_uninstall_result.request_id, body: frame.extension_uninstall_result };
  }
  return null;
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toQueryString(query: ObservabilityLogQuery): string {
  const params = new URLSearchParams();
  if (query.level) params.set('level', query.level);
  if (query.module) params.set('module', query.module);
  if (query.trace_id) params.set('trace_id', query.trace_id);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}
