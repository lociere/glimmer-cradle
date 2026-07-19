import type { ConfigurationSnapshot, PresentationRuntimeReadinessState } from '@glimmer-cradle/protocol';
import type { ReadinessStatus, RuntimeProjection } from '../../shared/api/personal-server-client';

export interface StatusViewSnapshot {
  readonly status: ReadinessStatus | null;
  readonly runtimes: ReadonlyArray<RuntimeProjection>;
  readonly configuration: ConfigurationSnapshot | null;
}

export class StatusView {
  public constructor(private readonly root: HTMLElement) {}

  public render(snapshot: StatusViewSnapshot): void {
    const totalRuntimes = snapshot.runtimes.length;
    const readyRuntimes = snapshot.runtimes.filter((runtime) => runtime.state === 'ready').length;
    const degradedRuntimes = snapshot.runtimes.filter((runtime) => runtime.state === 'degraded' || runtime.state === 'failed').length;
    const route = snapshot.configuration?.llm.default_route;
    const providerSummary = route?.provider_key
      ? `${route.provider_key}${route.model_alias ? ` / ${route.model_alias}` : ''}`
      : '未配置';

    this.root.innerHTML = `
      <header class="workspace-head">
        <div><span>状态</span><h1>运行状态</h1></div>
      </header>
      <div class="status-scroll">
        <section class="status-card-grid">
          <article class="status-card">
            <span>服务状态</span>
            <strong>${escapeHtml(snapshot.status?.ready ? 'ready' : snapshot.status?.status || 'starting')}</strong>
            <p>${escapeHtml(snapshot.status?.summary || '等待 Kernel readiness 投影。')}</p>
          </article>
          <article class="status-card">
            <span>连接</span>
            <strong>${escapeHtml(snapshot.status?.connection_state || 'disconnected')}</strong>
            <p>${escapeHtml(snapshot.status?.connection_error || formatObservedAt(snapshot.status?.observed_at))}</p>
          </article>
          <article class="status-card">
            <span>模型路由</span>
            <strong>${escapeHtml(route?.ready ? '可用' : 'degraded')}</strong>
            <p>${escapeHtml(route?.ready ? providerSummary : route?.reason || '尚未配置默认模型。')}</p>
          </article>
          <article class="status-card">
            <span>运行体</span>
            <strong>${readyRuntimes}/${totalRuntimes}</strong>
            <p>${degradedRuntimes > 0 ? `存在 ${degradedRuntimes} 个 degraded/failed 运行体。` : '当前没有 degraded 运行体。'}</p>
          </article>
        </section>

        <section class="status-section">
          <div class="status-section-head">
            <div><span>运行体目录</span><h2>Kernel / Cognition / Audio / Extension Host</h2></div>
          </div>
          <div class="status-runtime-list">
            ${snapshot.runtimes.length > 0
              ? snapshot.runtimes.map((runtime) => this.renderRuntime(runtime)).join('')
              : '<div class="status-empty"><strong>尚未收到 runtime catalog</strong><p>Personal Server 已登录，但还在等待 Control Surface 推送完整运行体快照。</p></div>'}
          </div>
        </section>
      </div>
    `;
  }

  private renderRuntime(runtime: RuntimeProjection): string {
    const stateClass = `state-${normalizeState(runtime.state)}`;
    const duration = typeof runtime.duration_ms === 'number'
      ? ` · ${Math.round(runtime.duration_ms)} ms`
      : '';
    const resources = runtime.reconciler?.resources?.length
      ? ` · 资源 ${runtime.reconciler.resources.length}`
      : '';
    return `
      <article class="status-runtime-row ${stateClass}">
        <div class="status-runtime-main">
          <strong>${escapeHtml(runtime.runtime_id)}</strong>
          <p>${escapeHtml(runtime.summary || `${runtime.owner} / ${runtime.phase}`)}</p>
        </div>
        <div class="status-runtime-meta">
          <span>${escapeHtml(runtime.owner)}</span>
          <span>${escapeHtml(runtime.phase || 'runtime')}</span>
        </div>
        <div class="status-runtime-side">
          <strong>${escapeHtml(runtime.state)}</strong>
          <span>${escapeHtml(`${duration}${resources}`.replace(/^ · /, ''))}</span>
        </div>
      </article>
    `;
  }
}

function normalizeState(value: PresentationRuntimeReadinessState): string {
  return value;
}

function formatObservedAt(value: number | undefined): string {
  if (!value) return '尚未收到最近一次状态时间戳。';
  return `最近观测 ${new Date(value).toLocaleTimeString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
