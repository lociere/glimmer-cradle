import type { ProviderDraftState } from '../configuration-state';
import { escapeAttribute, escapeHtml } from '../configuration-support';

export function renderProvidersSection(
  providers: ProviderDraftState[],
  selectedProviderKey: string,
  selected: ProviderDraftState | null,
): string {
  return `
    <section class="settings-section providers-shell">
      <div class="settings-section-head">
        <div><span>服务提供商</span><h2>LLM Provider</h2></div>
        <button class="quiet-button" type="button" data-action="add-provider">新增 Provider</button>
      </div>
      <div class="providers-layout">
        <aside class="provider-list" data-role="provider-list">
          ${providers.length > 0
            ? providers.map((provider) => `
              <button class="provider-row ${provider.key === selectedProviderKey ? 'is-active' : ''}" type="button" data-provider="${escapeAttribute(provider.key)}">
                <strong>${escapeHtml(provider.key)}</strong>
                <span>${escapeHtml(provider.api_type)}${provider.has_api_key ? ' · 已写入密钥' : ' · 未写入密钥'}</span>
              </button>
            `).join('')
            : `<div class="empty-substate"><strong>还没有 Provider</strong><p>控制面已可登录；只有执行依赖 LLM 的对话时，才会明确提示尚未配置可用模型。</p></div>`}
        </aside>
        <div class="provider-editor" data-role="provider-editor">
          ${selected ? renderProviderEditor(selected) : `
            <div class="empty-substate"><strong>选择一个 Provider</strong><p>从左侧选择现有 Provider，或新增一个新的服务提供商条目。</p></div>
          `}
        </div>
      </div>
    </section>
  `;
}

function renderProviderEditor(provider: ProviderDraftState): string {
  return `
    <div class="provider-editor-head">
      <div><span>当前 Provider</span><h3>${escapeHtml(provider.key || '未命名 Provider')}</h3></div>
      <button class="danger-button" type="button" data-action="remove-provider">删除</button>
    </div>
    <div class="field-grid">
      <label class="field">
        <span>Provider key</span>
        <input type="text" value="${escapeAttribute(provider.key)}" data-field="provider-key" spellcheck="false">
      </label>
      <label class="field">
        <span>API 协议</span>
        <input type="text" value="${escapeAttribute(provider.api_type)}" data-field="provider-api-type" spellcheck="false">
      </label>
      <label class="field field-wide">
        <span>Base URL</span>
        <input type="url" value="${escapeAttribute(provider.base_url)}" data-field="provider-base-url" spellcheck="false" placeholder="https://api.example.com">
      </label>
      <label class="field">
        <span>API Key（write-only）</span>
        <input type="password" value="" data-field="provider-api-key" placeholder="${provider.has_api_key ? '已写入，留空表示保持不变' : '未写入'}">
      </label>
      <label class="field">
        <span>温度</span>
        <input type="number" min="0" max="2" step="0.1" value="${escapeAttribute(provider.temperature)}" data-field="provider-temperature">
      </label>
      <label class="field field-wide">
        <span>连接测试 / 模型发现</span>
        <div class="inline-actions">
          <label class="toggle-line"><input type="checkbox" data-field="provider-clear-secret" ${provider.clear_api_key ? 'checked' : ''}>清除已保存 API Key</label>
          <button class="quiet-button" type="button" data-action="test-provider">测试连接并发现模型</button>
        </div>
      </label>
    </div>
    <div class="model-editor">
      <div class="settings-section-head compact">
        <div><span>模型列表</span><h3>模型别名</h3></div>
        <button class="quiet-button" type="button" data-action="add-model">新增模型</button>
      </div>
      <div class="model-table">
        ${provider.models.map((model, index) => `
          <div class="model-row">
            <input type="text" value="${escapeAttribute(model.alias)}" data-model-alias="${index}" placeholder="chat">
            <input type="text" value="${escapeAttribute(model.model_id)}" data-model-id="${index}" placeholder="gpt-4.1">
            <button class="quiet-button" type="button" data-action="remove-model" data-model-index="${index}">删除</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}
