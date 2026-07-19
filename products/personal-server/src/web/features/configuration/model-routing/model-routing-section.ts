import type { ConfigurationRouteSnapshot } from '@glimmer-cradle/protocol';
import type { ConfigurationDraftState } from '../configuration-state';
import { escapeAttribute, escapeHtml } from '../configuration-support';

export function renderRouteSummarySection(defaultRoute: ConfigurationRouteSnapshot): string {
  const routeReady = defaultRoute.ready;
  const routeLabel = defaultRoute.provider_key
    ? `${defaultRoute.provider_key}${defaultRoute.model_alias ? ` / ${defaultRoute.model_alias}` : ''}`
    : '未选择';
  return `
    <section class="settings-section route-summary ${routeReady ? 'is-ready' : 'is-degraded'}">
      <span>模型与路由</span>
      <h2>${routeReady ? '默认对话路由可用' : '默认对话路由未就绪'}</h2>
      <p>${escapeHtml(routeReady ? `当前路由：${routeLabel}` : (defaultRoute.reason || '尚未选择默认模型。'))}</p>
    </section>
  `;
}

export function renderModelRoutingSection(
  draft: ConfigurationDraftState,
  routeOptions: Array<{ alias: string; model_id: string }>,
): string {
  return `
    <section class="settings-section">
      <div class="settings-section-head">
        <div><span>默认路由</span><h2>对话模型选择</h2></div>
      </div>
      <div class="field-grid route-grid">
        <label class="field">
          <span>默认 Provider</span>
          <select data-field="default-route-provider">
            <option value="">未选择</option>
            ${draft.providers.map((provider) => `
              <option value="${escapeAttribute(provider.key)}" ${provider.key === draft.defaultRouteProviderKey ? 'selected' : ''}>${escapeHtml(provider.key)}</option>
            `).join('')}
          </select>
        </label>
        <label class="field">
          <span>默认模型</span>
          <select data-field="default-route-model" ${draft.defaultRouteProviderKey ? '' : 'disabled'}>
            <option value="">未选择</option>
            ${routeOptions.map((model) => `
              <option value="${escapeAttribute(model.alias)}" ${model.alias === draft.defaultRouteModelAlias ? 'selected' : ''}>
                ${escapeHtml(model.alias)} · ${escapeHtml(model.model_id)}
              </option>
            `).join('')}
          </select>
        </label>
      </div>
    </section>
  `;
}
