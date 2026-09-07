import type {
  ConfigurationSnapshot,
  RuntimeReadinessCatalog,
  RuntimeProjection,
  ConversationHistoryRequest,
  ConversationHistoryResult,
} from '../../shared/control-center-models';
import type { ConfigurationPort } from '../features/configuration/ConfigurationController';
import type { ExtensionsPort } from '../features/capabilities/ExtensionsController';
import type { ActivityPort } from '../features/activity/ActivityController';
import {
  PersonalServerClient,
  type PersonalServerSurface,
  type ReadinessStatus,
  type SurfaceFrame,
} from '../shared/api/personal-server-client';

export type SessionState = 'loading' | 'anonymous' | 'authenticated';
export type ConnectionState = 'online' | 'connecting' | 'waiting';

export interface PersonalServerAppSnapshot {
  readonly session: SessionState;
  readonly connection: ConnectionState;
  readonly productName: string;
  readonly status: ReadinessStatus | null;
  readonly statusError: string | null;
  readonly runtimes: readonly RuntimeProjection[];
  readonly runtimeCatalogUpdatedAt: number | null;
  readonly runtimeCatalogCurrent: boolean;
  readonly configuration: ConfigurationSnapshot | null;
  readonly loginPending: boolean;
  readonly loginMessage: string;
}

const initialSnapshot: PersonalServerAppSnapshot = {
  session: 'loading',
  connection: 'waiting',
  productName: 'Personal Server',
  status: null,
  statusError: null,
  runtimes: [],
  runtimeCatalogUpdatedAt: null,
  runtimeCatalogCurrent: false,
  configuration: null,
  loginPending: false,
  loginMessage: '',
};

export class PersonalServerAppController {
  private readonly client = new PersonalServerClient();
  private readonly listeners = new Set<() => void>();
  private readonly conversationListeners = new Set<(frame: SurfaceFrame) => void>();
  private snapshot: PersonalServerAppSnapshot = initialSnapshot;
  private running = false;
  private generation = 0;
  private readinessTimer: ReturnType<typeof setTimeout> | null = null;
  private authenticatedAbort: AbortController | null = null;
  private logoutRequest: Promise<void> | null = null;
  private surface: PersonalServerSurface | null = null;
  private readonly extensionListeners = new Set<(frame: SurfaceFrame) => void>();


  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (): PersonalServerAppSnapshot => this.snapshot;

  public start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    this.patch({ session: 'loading', loginMessage: '' });
    void this.initialize(generation);
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.teardownAuthenticated();
  }

  public async login(token: string): Promise<void> {
    if (this.snapshot.loginPending) return;
    this.patch({ loginPending: true, loginMessage: '' });
    const pendingLogout = this.logoutRequest;
    if (pendingLogout) await pendingLogout;
    if (!this.running) return;
    const generation = ++this.generation;
    try {
      const response = await this.client.login(token);
      if (!this.isCurrent(generation) || this.snapshot.session !== 'anonymous') return;
      if (!response.ok) {
        this.patch({
          loginPending: false,
          loginMessage: response.status === 429 ? '尝试次数过多，请稍后再试。' : '访问令牌不正确。',
        });
        return;
      }
      this.patch({ session: 'authenticated', loginPending: false, loginMessage: '' });
      await this.startAuthenticated(generation);
    } catch {
      if (this.isCurrent(generation)) {
        this.patch({ loginPending: false, loginMessage: '无法连接 Personal Server，请确认服务仍在运行。' });
      }
    }
  }

  public async logout(): Promise<void> {
    if (this.logoutRequest) return this.logoutRequest;
    this.transitionToAnonymous('');
    const request = this.client.logout()
      .catch(() => undefined)
      .finally(() => {
        if (this.logoutRequest === request) this.logoutRequest = null;
      });
    this.logoutRequest = request;
    await request;
  }

  public subscribeConversation(listener: (frame: SurfaceFrame) => void): () => void {
    this.conversationListeners.add(listener);
    return () => { this.conversationListeners.delete(listener); };
  }

  public async readConversationHistory(request: ConversationHistoryRequest, signal: AbortSignal): Promise<ConversationHistoryResult> {
    const surface = this.surface;
    const generation = this.generation;
    if (signal.aborted || !surface || surface.readyState !== WebSocket.OPEN) throw new Error('对话连接尚未就绪。');
    const result = await surface.requestConversationHistory(request);
    if (signal.aborted || !this.isActiveSurface(surface, generation)) throw new Error('对话读取已取消。');
    if (result.status !== 'success') throw new Error(result.message || '历史读取失败。');
    return result;
  }

  public sendConversation(text: string, traceId: string): void {
    if (this.snapshot.session !== 'authenticated' || this.surface?.readyState !== WebSocket.OPEN) throw new Error('对话连接已断开。');
    this.surface.sendChatInput(text, traceId);
  }

  public async readConfiguration(signal: AbortSignal): Promise<ConfigurationSnapshot> {
    const surface = this.surface;
    const generation = this.generation;
    if (signal.aborted || !surface || surface.readyState !== WebSocket.OPEN) throw new Error('控制面尚未连接。');
    const configuration = await surface.requestConfigurationSnapshot();
    if (signal.aborted || !this.isActiveSurface(surface, generation)) throw new Error('读取已取消或连接已改变。');
    this.patch({ configuration });
    return configuration;
  }

  public subscribeExtensions(listener: (frame: SurfaceFrame) => void): () => void {
    this.extensionListeners.add(listener);
    return () => { this.extensionListeners.delete(listener); };
  }

  public createExtensionsPort(): ExtensionsPort | null {
    const surface = this.surface;
    const generation = this.generation;
    if (!surface || surface.readyState !== WebSocket.OPEN) return null;
    const guard = () => {
      if (!this.isActiveSurface(surface, generation) || surface.readyState !== WebSocket.OPEN) throw new Error('扩展连接已断开。');
    };
    const requestId = () => crypto.randomUUID();
    return {
      read: () => { guard(); return surface.requestExtensionRuntimeProjection({ request_id: requestId() }); },
      prepare: (request) => { guard(); return surface.prepareExtensionInstall(request); },
      commit: (preview) => { guard(); return surface.commitExtensionInstall({ request_id: requestId(), transaction_id: preview.transaction_id!, approved_permissions: preview.extension?.permissions ?? [] }); },
      cancel: (transactionId) => { guard(); return surface.cancelExtensionInstall(requestId(), transactionId); },
      lifecycle: (id, operation, version) => { guard(); return surface.requestExtensionLifecycle({ request_id: requestId(), extension_id: id, operation, version }); },
      uninstall: (id, version) => { guard(); return surface.uninstallExtension({ request_id: requestId(), extension_id: id, version }); },
      upload: (file) => { guard(); return this.client.uploadLocalExtensionPackage(file); },
    };
  }
  public createActivityPort(): ActivityPort {
    const generation = this.generation;
    const guard = () => {
      if (!this.isAuthenticatedGeneration(generation)) throw new Error('会话已失效。');
    };
    return {
      read: async (query, signal) => {
        guard();
        const sessionSignal = this.authenticatedAbort?.signal;
        try {
          const entries = await this.client.getRecentLogs(query, sessionSignal ? AbortSignal.any([signal, sessionSignal]) : signal);
          guard();
          return entries;
        } catch (error) {
          if (!signal.aborted && this.isAuthenticatedGeneration(generation) && error instanceof Error && error.message === 'unauthorized') this.transitionToAnonymous('会话已失效，请重新连接。');
          throw error;
        }
      },
      stream: (query, handlers) => {
        guard();
        const signal = this.authenticatedAbort?.signal;
        const stream = this.client.connectLogStream(query, {
          onOpen: () => { if (this.isAuthenticatedGeneration(generation)) handlers.onOpen(); },
          onEntry: (entry) => { if (this.isAuthenticatedGeneration(generation)) handlers.onEntry(entry); },
          onError: () => { if (this.isAuthenticatedGeneration(generation)) handlers.onError(); },
        });
        const close = () => { stream.close(); signal?.removeEventListener('abort', close); };
        signal?.addEventListener('abort', close, { once: true });
        if (signal?.aborted) close();
        return { close };
      },
    };
  }
  public createConfigurationPort(): ConfigurationPort | null {
    const surface = this.surface; const generation = this.generation;
    if (!surface || surface.readyState !== WebSocket.OPEN) return null;
    const abort = new AbortController();
    const sessionSignal = this.authenticatedAbort?.signal;
    const signal = sessionSignal ? AbortSignal.any([abort.signal, sessionSignal]) : abort.signal;
    const guard = () => { if (signal.aborted || !this.isActiveSurface(surface, generation) || surface.readyState !== WebSocket.OPEN) throw new Error('配置连接已断开。'); };
    const request = async <T,>(action: () => Promise<T>): Promise<T> => {
      guard();
      try { const result = await action(); guard(); return result; }
      catch (error) { if (!signal.aborted && this.isAuthenticatedGeneration(generation) && error instanceof Error && error.message === 'unauthorized') this.transitionToAnonymous('会话已失效，请重新连接。'); throw error; }
    };
    return {
      read: () => request(async () => { const configuration = await surface.requestConfigurationSnapshot(); guard(); this.patch({ configuration }); return configuration; }),
      preview: value => request(() => surface.previewConfigurationUpdate(value)),
      save: value => request(async () => { const result = await surface.applyConfigurationUpdate(value); guard(); if (result.snapshot && result.status === 'success') this.patch({ configuration: result.snapshot }); return result; }),
      testProvider: value => request(() => surface.testProvider(value)),
      tokens: () => request(() => this.client.getAccessTokenSnapshot(signal)),
      mutateToken: (action, value) => request(() => action === 'create' ? this.client.createAccessToken(value, signal) : action === 'rotate' ? this.client.rotateAccessToken(value, signal) : this.client.revokeAccessToken(value, signal)),
      operations: () => request(() => this.client.getOperationsSnapshot(signal)),
      runOperation: (operation, options) => request(() => this.client.runOperation(operation, options, signal)),
      operationResult: id => request(() => this.client.getOperationResult(id, signal)),
      skills: () => request(() => surface.requestSkillCatalog({ request_id: crypto.randomUUID() })),
      close: () => abort.abort(),
    };
  }

  private async initialize(generation: number): Promise<void> {
    try {
      const session = await this.client.getSession();
      if (!this.isCurrent(generation)) return;
      if (!session.authenticated) {
        this.patch({ session: 'anonymous' });
        return;
      }
      this.patch({ session: 'authenticated' });
      await this.startAuthenticated(generation);
    } catch {
      if (this.isCurrent(generation)) {
        this.patch({ session: 'anonymous', loginMessage: '无法确认会话，请重新连接。' });
      }
    }
  }

  private async startAuthenticated(generation: number): Promise<void> {
    if (!this.isAuthenticatedGeneration(generation)) return;
    this.authenticatedAbort?.abort();
    const abortController = new AbortController();
    this.authenticatedAbort = abortController;
    await Promise.all([
      this.refreshProduct(generation, abortController.signal),
      this.refreshStatus(generation, abortController.signal),
    ]);
    if (this.authenticatedAbort === abortController && this.isAuthenticatedGeneration(generation)) {
      this.connectSurface(generation);
    }
  }

  private async refreshProduct(generation: number, signal: AbortSignal): Promise<void> {
    try {
      const product = await this.client.getProduct(signal);
      if (!signal.aborted && this.isAuthenticatedGeneration(generation)) {
        this.patch({ productName: product.display_name || 'Personal Server' });
      }
    } catch {
      if (!signal.aborted && this.isAuthenticatedGeneration(generation)) {
        this.patch({ productName: 'Personal Server' });
      }
    }
  }

  private async refreshStatus(generation: number, signal: AbortSignal): Promise<void> {
    try {
      const status = await this.client.getStatus(signal);
      if (signal.aborted || !this.isAuthenticatedGeneration(generation)) return;
      this.patch({ status, statusError: null });
      if (status.ready && (!this.surface || this.surface.readyState === WebSocket.CLOSED)) {
        this.connectSurface(generation);
      }
      this.scheduleStatusRefresh(generation, signal, status.ready ? 5000 : 1500);
    } catch (error) {
      if (signal.aborted || !this.isAuthenticatedGeneration(generation)) return;
      if (error instanceof Error && error.message === 'unauthorized') {
        this.transitionToAnonymous('会话已失效，请重新连接。');
        return;
      }
      this.patch({ statusError: '无法读取服务状态，正在自动重试。' });
      this.scheduleStatusRefresh(generation, signal, 1500);
    }
  }

  private scheduleStatusRefresh(generation: number, signal: AbortSignal, delayMs: number): void {
    if (signal.aborted || !this.isAuthenticatedGeneration(generation)) return;
    this.clearReadinessTimer();
    const timer = setTimeout(() => {
      if (this.readinessTimer === timer) this.readinessTimer = null;
      if (!signal.aborted && this.isAuthenticatedGeneration(generation)) {
        void this.refreshStatus(generation, signal);
      }
    }, delayMs);
    this.readinessTimer = timer;
  }

  private connectSurface(generation: number): void {
    if (!this.isAuthenticatedGeneration(generation)) return;
    if (this.surface?.readyState === WebSocket.OPEN || this.surface?.readyState === WebSocket.CONNECTING) return;
    this.patch({ connection: 'connecting' });
    let surface!: PersonalServerSurface;
    surface = this.client.connectSurface({
      onOpen: async () => {
        if (!this.isActiveSurface(surface, generation)) return;
        this.patch({ connection: 'online' });

        if (!this.isActiveSurface(surface, generation)) return;
      },
      onFrame: (frame) => {
        if (this.isActiveSurface(surface, generation)) this.handleSurfaceFrame(frame);
      },
      onClose: () => {
        if (!this.isActiveSurface(surface, generation)) return;

        this.surface = null;
        this.patch({ connection: 'waiting', runtimeCatalogCurrent: false });
        const signal = this.authenticatedAbort?.signal;
        if (signal) this.scheduleStatusRefresh(generation, signal, 1000);
      },
    });
    this.surface = surface;
  }

  private handleSurfaceFrame(frame: SurfaceFrame): void {
    for (const listener of this.conversationListeners) listener(frame);
    for (const listener of this.extensionListeners) listener(frame);
    if (frame.kind === 'runtime_readiness' && frame.runtime_readiness) {
      const catalog = frame.runtime_readiness as RuntimeReadinessCatalog;
      this.patch({ runtimes: catalog.runtimes, runtimeCatalogUpdatedAt: catalog.updated_at, runtimeCatalogCurrent: true });
      return;
    }
  }

  private teardownAuthenticated(): void {
    this.clearReadinessTimer();
    this.authenticatedAbort?.abort();
    this.authenticatedAbort = null;
    const surface = this.surface;
    this.surface = null;
    surface?.close();


  }

  private clearReadinessTimer(): void {
    if (!this.readinessTimer) return;
    clearTimeout(this.readinessTimer);
    this.readinessTimer = null;
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private isAuthenticatedGeneration(generation: number): boolean {
    return this.isCurrent(generation) && this.snapshot.session === 'authenticated';
  }

  private isActiveSurface(surface: PersonalServerSurface, generation: number): boolean {
    return this.isAuthenticatedGeneration(generation) && this.surface === surface;
  }

  private transitionToAnonymous(message: string): void {
    this.generation += 1;
    this.teardownAuthenticated();
    this.patch({ ...initialSnapshot, session: 'anonymous', loginMessage: message });
  }

  private patch(patch: Partial<PersonalServerAppSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
