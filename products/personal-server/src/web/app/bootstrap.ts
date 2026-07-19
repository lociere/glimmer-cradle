import type {
  ConfigurationSnapshot,
  PresentationRuntimeReadinessCatalogPayload,
} from '@glimmer-cradle/protocol';
import {
  PersonalServerClient,
  type PersonalServerSurface,
  type ProductProjection,
  type ReadinessStatus,
  type RuntimeProjection,
  type SurfaceFrame,
} from '../shared/api/personal-server-client';
import { ConfigurationView } from '../features/configuration/configuration-view';
import { ConversationView } from '../features/conversation/conversation-view';
import { ExtensionView } from '../features/extensions/extension-view';
import { ObservabilityView } from '../features/observability/observability-view';
import { StatusView } from '../features/status/status-view';
import { AppRouter, type AppRoute } from './router';
import { applyRouteShellState, renderShell } from '../shell/layout';

const state = {
  client: new PersonalServerClient(),
  router: new AppRouter(),
  product: null as ProductProjection | null,
  status: null as ReadinessStatus | null,
  runtimeCatalog: [] as RuntimeProjection[],
  configurationSnapshot: null as ConfigurationSnapshot | null,
  surface: null as PersonalServerSurface | null,
  readinessTimer: null as ReturnType<typeof setTimeout> | null,
  conversationView: null as ConversationView | null,
  extensionView: null as ExtensionView | null,
  configurationView: null as ConfigurationView | null,
  statusView: null as StatusView | null,
  observabilityView: null as ObservabilityView | null,
};

export async function bootstrapPersonalServerWeb(root: HTMLElement | null): Promise<void> {
  if (!root) throw new Error('缺少 app-root');
  const shell = renderShell(root);
  wireRoutes(shell);
  wireLogin(shell);
  wireConversation(shell);
  wireStatus(shell);
  wireExtensions(shell);
  wireLogs(shell);
  wireSettings(shell);
  query<HTMLButtonElement>(shell.appShell, '[data-role="logout-button"]').addEventListener('click', async () => {
    await state.client.logout();
    showLogin(shell);
  });

  const session = await state.client.getSession();
  if (!session.authenticated) {
    showLogin(shell);
    return;
  }
  await showApp(shell);
}

function wireRoutes(shell: ReturnType<typeof renderShell>): void {
  for (const button of Array.from(shell.routeButtons)) {
    button.addEventListener('click', () => {
      const route = button.dataset.route as AppRoute | undefined;
      if (route) state.router.navigate(route);
    });
  }
  state.router.subscribe((route) => applyRouteShellState(shell, route));
}

function wireLogin(shell: ReturnType<typeof renderShell>): void {
  shell.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    shell.loginMessage.textContent = '';
    const response = await state.client.login(shell.accessToken.value);
    shell.accessToken.value = '';
    if (!response.ok) {
      shell.loginMessage.textContent = response.status === 429
        ? '尝试次数过多，请稍后再试。'
        : '访问令牌不正确。';
      return;
    }
    await showApp(shell);
  });
}

function wireConversation(shell: ReturnType<typeof renderShell>): void {
  state.conversationView = new ConversationView(shell.viewConversation, {
    getSurface: () => state.surface,
  });
}

function wireStatus(shell: ReturnType<typeof renderShell>): void {
  state.statusView = new StatusView(shell.viewStatus);
  renderStatusView();
}

function wireExtensions(shell: ReturnType<typeof renderShell>): void {
  state.extensionView = new ExtensionView(shell.viewExtensions, {
    getSurface: () => state.surface,
    uploadLocalPackage: (file) => state.client.uploadLocalExtensionPackage(file),
  });
  state.extensionView.renderLoading();
}

function wireLogs(shell: ReturnType<typeof renderShell>): void {
  state.observabilityView = new ObservabilityView(shell.viewLogs, {
    listRecent: (query) => state.client.getRecentLogs(query),
    connectStream: (query, handlers) => state.client.connectLogStream(query, handlers),
  });
}

function wireSettings(shell: ReturnType<typeof renderShell>): void {
  state.configurationView = new ConfigurationView(shell.viewSettings, {
    onPreview: async (request) => {
      if (!state.surface) throw new Error('surface_unavailable');
      return state.surface.previewConfigurationUpdate(request);
    },
    onSave: async (request) => {
      if (!state.surface) throw new Error('surface_unavailable');
      return state.surface.applyConfigurationUpdate(request);
    },
    onTestProvider: async (request) => {
      if (!state.surface) throw new Error('surface_unavailable');
      return state.surface.testProvider(request);
    },
    loadAccessTokens: () => state.client.getAccessTokenSnapshot(),
    createAccessToken: (label) => state.client.createAccessToken(label),
    rotateAccessToken: (tokenId) => state.client.rotateAccessToken(tokenId),
    revokeAccessToken: (tokenId) => state.client.revokeAccessToken(tokenId),
    loadOperations: () => state.client.getOperationsSnapshot(),
    runOperation: (operation, options) => state.client.runOperation(operation, options),
    loadSkillCatalog: async () => {
      if (!state.surface) throw new Error('surface_unavailable');
      return state.surface.requestSkillCatalog({ request_id: `skill-catalog-${Date.now()}` });
    },
  });
  state.configurationView.renderLoading();
  shell.viewSettings.addEventListener('configuration:reload', () => {
    void loadConfiguration();
  });
}

async function showApp(shell: ReturnType<typeof renderShell>): Promise<void> {
  shell.loginLayer.hidden = true;
  shell.appShell.hidden = false;
  state.observabilityView?.start();
  await refreshProduct(shell);
  await refreshStatus(shell);
  connectSurface(shell);
}

function showLogin(shell: ReturnType<typeof renderShell>): void {
  if (state.readinessTimer) clearTimeout(state.readinessTimer);
  state.surface?.close();
  state.surface = null;
  state.status = null;
  state.runtimeCatalog = [];
  state.configurationSnapshot = null;
  state.conversationView?.reset();
  state.extensionView?.reset();
  state.observabilityView?.stop();
  renderStatusView();
  shell.appShell.hidden = true;
  shell.loginLayer.hidden = false;
  queueMicrotask(() => shell.accessToken.focus());
}

async function refreshProduct(shell: ReturnType<typeof renderShell>): Promise<void> {
  try {
    state.product = await state.client.getProduct();
    shell.productName.textContent = state.product.display_name || 'Personal Server';
  } catch {
    state.product = null;
    shell.productName.textContent = 'Personal Server';
  }
}

async function refreshStatus(shell: ReturnType<typeof renderShell>): Promise<void> {
  try {
    state.status = await state.client.getStatus();
  } catch (error) {
    if ((error as Error).message === 'unauthorized') {
      showLogin(shell);
      return;
    }
    return;
  }
  renderStatusView();
  if (state.status.ready && (!state.surface || state.surface.readyState === WebSocket.CLOSED)) {
    connectSurface(shell);
  }
  scheduleStatusRefresh(shell, state.status.ready ? 5000 : 1500);
}

function scheduleStatusRefresh(shell: ReturnType<typeof renderShell>, delayMs: number): void {
  if (state.readinessTimer) clearTimeout(state.readinessTimer);
  state.readinessTimer = setTimeout(() => void refreshStatus(shell), delayMs);
}

function connectSurface(shell: ReturnType<typeof renderShell>): void {
  if (state.surface?.readyState === WebSocket.OPEN || state.surface?.readyState === WebSocket.CONNECTING) return;
  updateConnection(shell, 'connecting');
  state.surface = state.client.connectSurface({
    onOpen: async () => {
      updateConnection(shell, 'online');
      await state.conversationView?.handleSurfaceOpen();
      await state.extensionView?.handleSurfaceOpen();
      void loadConfiguration();
    },
    onFrame: (frame) => handleSurfaceFrame(shell, frame),
    onClose: () => {
      state.conversationView?.handleSurfaceClose();
      state.extensionView?.handleSurfaceClose();
      state.surface = null;
      updateConnection(shell, 'waiting');
      scheduleStatusRefresh(shell, 1000);
    },
  });
}

function handleSurfaceFrame(shell: ReturnType<typeof renderShell>, frame: SurfaceFrame): void {
  state.conversationView?.handleFrame(frame);
  state.extensionView?.handleFrame(frame);
  if (frame.kind === 'runtime_readiness' && frame.runtime_readiness) {
    updateRuntimeCatalog(frame.runtime_readiness as PresentationRuntimeReadinessCatalogPayload);
    return;
  }
  if (frame.kind === 'configuration_snapshot_result' && frame.configuration_snapshot_result?.snapshot) {
    state.configurationSnapshot = frame.configuration_snapshot_result.snapshot;
    renderStatusView();
  }
}

function updateRuntimeCatalog(catalog: PresentationRuntimeReadinessCatalogPayload): void {
  state.runtimeCatalog = catalog.runtimes as RuntimeProjection[];
  renderStatusView();
}

async function loadConfiguration(): Promise<void> {
  if (!state.configurationView) return;
  if (!state.surface || state.surface.readyState !== WebSocket.OPEN) {
    state.configurationView.renderLoading('控制面尚未连接到 Kernel，暂时无法读取配置。');
    return;
  }
  state.configurationView.renderLoading();
  try {
    const snapshot = await state.surface.requestConfigurationSnapshot();
    state.configurationSnapshot = snapshot;
    state.configurationView.renderSnapshot(snapshot);
    renderStatusView();
  } catch (error) {
    state.configurationView.renderLoading(error instanceof Error ? error.message : String(error));
  }
}

function renderStatusView(): void {
  state.statusView?.render({
    status: state.status,
    runtimes: state.runtimeCatalog,
    configuration: state.configurationSnapshot,
  });
}

function updateConnection(shell: ReturnType<typeof renderShell>, stateLabel: 'online' | 'connecting' | 'waiting'): void {
  const labels = { online: '在线', connecting: '连接中', waiting: '等待服务' } as const;
  for (const label of shell.connectionLabels) {
    label.textContent = labels[stateLabel];
  }
  shell.paneStatusLabel.textContent = labels[stateLabel];
  for (const dot of shell.connectionDots) {
    dot.className = stateLabel === 'online' ? 'is-online' : '';
  }
  shell.paneStatusDot.className = stateLabel === 'online' ? 'is-online' : '';
}

function query<TElement extends Element>(root: ParentNode, selector: string): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
