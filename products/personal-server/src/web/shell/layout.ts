import type { AppRoute } from '../app/router';

export interface ShellReferences {
  readonly loginLayer: HTMLElement;
  readonly loginForm: HTMLFormElement;
  readonly accessToken: HTMLInputElement;
  readonly loginMessage: HTMLOutputElement;
  readonly appShell: HTMLElement;
  readonly connectionLabels: readonly HTMLElement[];
  readonly connectionDots: readonly HTMLElement[];
  readonly paneStatusLabel: HTMLElement;
  readonly paneStatusDot: HTMLElement;
  readonly productName: HTMLElement;
  readonly titleSection: HTMLElement;
  readonly titlePage: HTMLElement;
  readonly paneEyebrow: HTMLElement;
  readonly paneTitle: HTMLElement;
  readonly routeButtons: NodeListOf<HTMLButtonElement>;
  readonly viewConversation: HTMLElement;
  readonly viewStatus: HTMLElement;
  readonly viewExtensions: HTMLElement;
  readonly viewLogs: HTMLElement;
  readonly viewSettings: HTMLElement;
}

export function renderShell(root: HTMLElement): ShellReferences {
  root.innerHTML = `
    <div class="login-layer" data-role="login-layer" hidden>
      <form class="login-panel" data-role="login-form">
        <span class="brand-mark" aria-hidden="true">G</span>
        <h1>连接微光摇篮</h1>
        <p>输入部署时生成的访问令牌。</p>
        <input class="visually-hidden" name="username" value="personal-server" autocomplete="username" tabindex="-1" aria-hidden="true">
        <label for="access-token">访问令牌</label>
        <input id="access-token" name="token" type="password" autocomplete="current-password" required>
        <button type="submit">连接</button>
        <output data-role="login-message" aria-live="polite"></output>
      </form>
    </div>

    <div class="app-shell" data-role="app-shell" hidden>
      <header class="titlebar">
        <button class="brand-button" type="button" data-route="conversation" aria-label="对话">G</button>
        <div class="title-context"><span data-role="title-section">对话</span><strong data-role="title-page">当前对话</strong></div>
        <div class="connection-state"><i data-role="connection-dot"></i><span data-role="connection-label">连接中</span></div>
      </header>

      <aside class="rail" aria-label="主导航">
        <button class="rail-button is-active" type="button" data-route="conversation" aria-label="对话">对</button>
        <button class="rail-button" type="button" data-route="status" aria-label="系统状态">态</button>
        <button class="rail-button" type="button" data-route="extensions" aria-label="扩展">扩</button>
        <button class="rail-button" type="button" data-route="logs" aria-label="日志">志</button>
        <button class="rail-button" type="button" data-route="settings" aria-label="设置">设</button>
        <button class="rail-button rail-bottom" data-role="logout-button" type="button" aria-label="退出">退</button>
      </aside>

      <aside class="section-pane">
        <div class="pane-heading"><span data-role="pane-eyebrow">对话</span><h2 data-role="pane-title">对话</h2></div>
        <nav>
          <button class="section-link is-active" type="button" data-route="conversation"><span>当前对话</span><i>›</i></button>
          <button class="section-link" type="button" data-route="status"><span>系统状态</span><i>›</i></button>
          <button class="section-link" type="button" data-route="extensions"><span>扩展</span><i>›</i></button>
          <button class="section-link" type="button" data-route="logs"><span>日志工作台</span><i>›</i></button>
          <button class="section-link" type="button" data-route="settings"><span>设置中心</span><i>›</i></button>
        </nav>
        <div class="pane-status"><i data-role="pane-status-dot"></i><div><strong data-role="pane-status-label">连接中</strong><span>Personal Server</span></div></div>
      </aside>

      <main class="workspace">
        <section class="workspace-view" data-role="view-conversation"></section>
        <section class="workspace-view" data-role="view-status" hidden></section>
        <section class="workspace-view extension-view" data-role="view-extensions" hidden></section>
        <section class="workspace-view observability-view" data-role="view-logs" hidden></section>
        <section class="workspace-view settings-view" data-role="view-settings" hidden></section>
      </main>

      <aside class="inspector">
        <div class="inspector-heading"><span>当前上下文</span><h2>Personal Server</h2></div>
        <section><span>连接</span><strong class="status-line"><i data-role="connection-dot"></i><b data-role="connection-label">连接中</b></strong></section>
        <section><span>产品形态</span><strong data-role="product-name">Personal Server</strong></section>
      </aside>
    </div>
  `;

  return {
    loginLayer: query<HTMLElement>(root, '[data-role="login-layer"]'),
    loginForm: query<HTMLFormElement>(root, '[data-role="login-form"]'),
    accessToken: query<HTMLInputElement>(root, '#access-token'),
    loginMessage: query<HTMLOutputElement>(root, '[data-role="login-message"]'),
    appShell: query<HTMLElement>(root, '[data-role="app-shell"]'),
    connectionLabels: queryAll<HTMLElement>(root, '[data-role="connection-label"]'),
    connectionDots: queryAll<HTMLElement>(root, '[data-role="connection-dot"]'),
    paneStatusLabel: query<HTMLElement>(root, '[data-role="pane-status-label"]'),
    paneStatusDot: query<HTMLElement>(root, '[data-role="pane-status-dot"]'),
    productName: query<HTMLElement>(root, '[data-role="product-name"]'),
    titleSection: query<HTMLElement>(root, '[data-role="title-section"]'),
    titlePage: query<HTMLElement>(root, '[data-role="title-page"]'),
    paneEyebrow: query<HTMLElement>(root, '[data-role="pane-eyebrow"]'),
    paneTitle: query<HTMLElement>(root, '[data-role="pane-title"]'),
    routeButtons: root.querySelectorAll<HTMLButtonElement>('[data-route]'),
    viewConversation: query<HTMLElement>(root, '[data-role="view-conversation"]'),
    viewStatus: query<HTMLElement>(root, '[data-role="view-status"]'),
    viewExtensions: query<HTMLElement>(root, '[data-role="view-extensions"]'),
    viewLogs: query<HTMLElement>(root, '[data-role="view-logs"]'),
    viewSettings: query<HTMLElement>(root, '[data-role="view-settings"]'),
  };
}

export function applyRouteShellState(references: ShellReferences, route: AppRoute): void {
  const labels = {
    conversation: { eyebrow: '对话', title: '对话', section: '对话', page: '当前对话' },
    status: { eyebrow: '状态', title: '系统状态', section: '状态', page: '运行状态' },
    extensions: { eyebrow: '能力', title: '扩展', section: '能力', page: '扩展' },
    logs: { eyebrow: '日志', title: '日志工作台', section: '日志', page: '结构化事件流' },
    settings: { eyebrow: '设置', title: '设置中心', section: '设置', page: '服务配置' },
  } as const;
  const current = labels[route];
  references.titleSection.textContent = current.section;
  references.titlePage.textContent = current.page;
  references.paneEyebrow.textContent = current.eyebrow;
  references.paneTitle.textContent = current.title;
  references.viewConversation.hidden = route !== 'conversation';
  references.viewStatus.hidden = route !== 'status';
  references.viewExtensions.hidden = route !== 'extensions';
  references.viewLogs.hidden = route !== 'logs';
  references.viewSettings.hidden = route !== 'settings';
  for (const button of Array.from(references.routeButtons)) {
    button.classList.toggle('is-active', button.dataset.route === route);
    if (button.dataset.route === route) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }
}

function query<TElement extends Element>(root: ParentNode, selector: string): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) throw new Error(`missing shell element: ${selector}`);
  return element;
}

function queryAll<TElement extends Element>(root: ParentNode, selector: string): readonly TElement[] {
  const elements = Array.from(root.querySelectorAll<TElement>(selector));
  if (elements.length === 0) throw new Error(`missing shell elements: ${selector}`);
  return elements;
}
