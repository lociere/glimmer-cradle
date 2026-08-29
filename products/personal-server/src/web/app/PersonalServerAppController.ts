import type {
  ConfigurationSnapshot,
  RuntimeReadinessCatalog,
  RuntimeProjection,
} from '../../shared/control-center-models';
import { ConfigurationView } from '../features/configuration/configuration-view';
import { ConversationView } from '../features/conversation/conversation-view';
import { ExtensionView } from '../features/extensions/extension-view';
import { ObservabilityView } from '../features/observability/observability-view';
import { StatusView } from '../features/status/status-view';
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
  readonly runtimes: readonly RuntimeProjection[];
  readonly configuration: ConfigurationSnapshot | null;
  readonly loginPending: boolean;
  readonly loginMessage: string;
}

const initialSnapshot: PersonalServerAppSnapshot = {
  session: 'loading',
  connection: 'waiting',
  productName: 'Personal Server',
  status: null,
  runtimes: [],
  configuration: null,
  loginPending: false,
  loginMessage: '',
};

export class PersonalServerAppController {
  private readonly client = new PersonalServerClient();
  private readonly listeners = new Set<() => void>();
  private snapshot: PersonalServerAppSnapshot = initialSnapshot;
  private running = false;
  private generation = 0;
  private readinessTimer: ReturnType<typeof setTimeout> | null = null;
  private authenticatedAbort: AbortController | null = null;
  private logoutRequest: Promise<void> | null = null;
  private surface: PersonalServerSurface | null = null;
  private conversationView: ConversationView | null = null;
  private extensionView: ExtensionView | null = null;
  private statusView: StatusView | null = null;
  private observabilityView: ObservabilityView | null = null;
  private configurationView: ConfigurationView | null = null;

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

  public mountConversation(root: HTMLElement): () => void {
    const view = new ConversationView(root, { getSurface: () => this.surface });
    this.conversationView = view;
    if (this.surface?.readyState === WebSocket.OPEN) void view.handleSurfaceOpen();
    return () => {
      view.reset();
      if (this.conversationView === view) this.conversationView = null;
    };
  }

  public mountOverview(root: HTMLElement): () => void {
    const view = new StatusView(root);
    this.statusView = view;
    this.renderStatus();
    return () => {
      if (this.statusView === view) this.statusView = null;
    };
  }

  public mountCapabilities(root: HTMLElement): () => void {
    const view = new ExtensionView(root, {
      getSurface: () => this.surface,
      uploadLocalPackage: (file) => this.client.uploadLocalExtensionPackage(file),
    });
    this.extensionView = view;
    view.renderLoading();
    if (this.surface?.readyState === WebSocket.OPEN) void view.handleSurfaceOpen();
    return () => {
      view.reset();
      if (this.extensionView === view) this.extensionView = null;
    };
  }

  public mountActivity(root: HTMLElement): () => void {
    const view = new ObservabilityView(root, {
      listRecent: (query) => this.client.getRecentLogs(query),
      connectStream: (query, handlers) => this.client.connectLogStream(query, handlers),
    });
    this.observabilityView = view;
    view.start();
    return () => {
      view.stop();
      if (this.observabilityView === view) this.observabilityView = null;
    };
  }

  public mountSettings(root: HTMLElement): () => void {
    const view = new ConfigurationView(root, {
      onPreview: async (request) => {
        if (!this.surface) throw new Error('surface_unavailable');
        return this.surface.previewConfigurationUpdate(request);
      },
      onSave: async (request) => {
        if (!this.surface) throw new Error('surface_unavailable');
        return this.surface.applyConfigurationUpdate(request);
      },
      onTestProvider: async (request) => {
        if (!this.surface) throw new Error('surface_unavailable');
        return this.surface.testProvider(request);
      },
      loadAccessTokens: () => this.client.getAccessTokenSnapshot(),
      createAccessToken: (label) => this.client.createAccessToken(label),
      rotateAccessToken: (tokenId) => this.client.rotateAccessToken(tokenId),
      revokeAccessToken: (tokenId) => this.client.revokeAccessToken(tokenId),
      loadOperations: () => this.client.getOperationsSnapshot(),
      runOperation: (operation, options) => this.client.runOperation(operation, options),
      loadOperationResult: (operationId) => this.client.getOperationResult(operationId),
      loadSkillCatalog: async () => {
        if (!this.surface) throw new Error('surface_unavailable');
        return this.surface.requestSkillCatalog({ request_id: `skill-catalog-${Date.now()}` });
      },
    });
    const reload = () => void this.loadConfiguration(view);
    root.addEventListener('configuration:reload', reload);
    this.configurationView = view;
    view.renderLoading();
    if (this.surface?.readyState === WebSocket.OPEN) void this.loadConfiguration(view);
    return () => {
      root.removeEventListener('configuration:reload', reload);
      if (this.configurationView === view) this.configurationView = null;
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
      this.patch({ status });
      this.renderStatus();
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
        await this.conversationView?.handleSurfaceOpen();
        if (!this.isActiveSurface(surface, generation)) return;
        await this.extensionView?.handleSurfaceOpen();
        if (!this.isActiveSurface(surface, generation)) return;
        if (this.configurationView) void this.loadConfiguration(this.configurationView);
      },
      onFrame: (frame) => {
        if (this.isActiveSurface(surface, generation)) this.handleSurfaceFrame(frame);
      },
      onClose: () => {
        if (!this.isActiveSurface(surface, generation)) return;
        this.conversationView?.handleSurfaceClose();
        this.extensionView?.handleSurfaceClose();
        this.surface = null;
        this.patch({ connection: 'waiting' });
        const signal = this.authenticatedAbort?.signal;
        if (signal) this.scheduleStatusRefresh(generation, signal, 1000);
      },
    });
    this.surface = surface;
  }

  private handleSurfaceFrame(frame: SurfaceFrame): void {
    this.conversationView?.handleFrame(frame);
    this.extensionView?.handleFrame(frame);
    if (frame.kind === 'extension_runtime_projection_changed') {
      // Runtime projection events do not carry the installation catalog; reload both views together.
      void this.extensionView?.handleSurfaceOpen();
    }
    if (frame.kind === 'runtime_readiness' && frame.runtime_readiness) {
      const catalog = frame.runtime_readiness as RuntimeReadinessCatalog;
      this.patch({ runtimes: catalog.runtimes as RuntimeProjection[] });
      this.renderStatus();
      return;
    }
    if (frame.kind === 'configuration_snapshot_result' && frame.configuration_snapshot_result?.snapshot) {
      this.patch({ configuration: frame.configuration_snapshot_result.snapshot });
      this.renderStatus();
    }
  }

  private async loadConfiguration(view: ConfigurationView): Promise<void> {
    if (this.configurationView !== view) return;
    if (!this.surface || this.surface.readyState !== WebSocket.OPEN) {
      view.renderLoading('控制面尚未连接到 Kernel，暂时无法读取配置。');
      return;
    }
    view.renderLoading();
    try {
      const configuration = await this.surface.requestConfigurationSnapshot();
      if (this.configurationView !== view) return;
      this.patch({ configuration });
      view.renderSnapshot(configuration);
      this.renderStatus();
    } catch (error) {
      if (this.configurationView === view) {
        view.renderLoading(error instanceof Error ? error.message : String(error));
      }
    }
  }

  private renderStatus(): void {
    this.statusView?.render({
      status: this.snapshot.status,
      runtimes: this.snapshot.runtimes,
      configuration: this.snapshot.configuration,
    });
  }

  private teardownAuthenticated(): void {
    this.clearReadinessTimer();
    this.authenticatedAbort?.abort();
    this.authenticatedAbort = null;
    const surface = this.surface;
    this.surface = null;
    surface?.close();
    this.conversationView?.handleSurfaceClose();
    this.extensionView?.handleSurfaceClose();
    this.observabilityView?.stop();
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
