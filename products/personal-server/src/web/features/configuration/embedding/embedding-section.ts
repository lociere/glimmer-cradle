import type { ConfigurationDraftState } from '../configuration-state';
import { escapeAttribute } from '../configuration-support';

export function renderEmbeddingSection(draft: ConfigurationDraftState): string {
  const dashscope = draft.embedding.providers['dashscope-text-embedding'];
  const local = draft.embedding.providers['local-sentence-transformers'];
  return `
    <section class="settings-section settings-card-shell">
      <div class="settings-section-head">
        <div><span>Embedding</span><h2>语义向量增强</h2></div>
      </div>
      <div class="settings-card settings-card-form">
        <p>默认关闭，关闭时不影响基础对话和控制面；启用后才进入语义检索增强。</p>
        <div class="field-grid">
          <div class="field">
            <span>Embedding</span>
            <label class="toggle-line"><input type="checkbox" data-path="embedding.enabled" ${draft.embedding.enabled ? 'checked' : ''}>启用向量增强</label>
          </div>
          <label class="field">
            <span>默认路由</span>
            <select data-path="embedding.route.provider">
              <option value="dashscope-text-embedding" ${draft.embedding.route.provider === 'dashscope-text-embedding' ? 'selected' : ''}>dashscope-text-embedding</option>
              <option value="local-sentence-transformers" ${draft.embedding.route.provider === 'local-sentence-transformers' ? 'selected' : ''}>local-sentence-transformers</option>
            </select>
          </label>
          <label class="field field-wide">
            <span>DashScope Endpoint</span>
            <input type="text" data-path="embedding.providers.dashscope-text-embedding.endpoint" value="${escapeAttribute(dashscope.endpoint)}">
          </label>
          <label class="field">
            <span>DashScope 模型</span>
            <input type="text" data-path="embedding.providers.dashscope-text-embedding.model" value="${escapeAttribute(dashscope.model)}">
          </label>
          <label class="field">
            <span>向量维度</span>
            <select data-path="embedding.providers.dashscope-text-embedding.dimensions" data-kind="number">
              ${[64, 128, 256, 512, 768, 1024, 1536, 2048].map((value) => `<option value="${value}" ${dashscope.dimensions === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>请求超时（ms）</span>
            <input type="number" min="1000" data-path="embedding.providers.dashscope-text-embedding.request_timeout_ms" data-kind="number" value="${escapeAttribute(String(dashscope.request_timeout_ms))}">
          </label>
          <label class="field">
            <span>最大重试</span>
            <input type="number" min="0" data-path="embedding.providers.dashscope-text-embedding.max_retries" data-kind="number" value="${escapeAttribute(String(dashscope.max_retries))}">
          </label>
          <label class="field">
            <span>本地模型目录</span>
            <input type="text" data-path="embedding.providers.local-sentence-transformers.model_path" value="${escapeAttribute(local.model_path)}">
          </label>
          <label class="field">
            <span>本地模型 ID</span>
            <input type="text" data-path="embedding.providers.local-sentence-transformers.model_id" value="${escapeAttribute(local.model_id)}">
          </label>
          <label class="field">
            <span>Device</span>
            <input type="text" data-path="embedding.providers.local-sentence-transformers.device" value="${escapeAttribute(local.device)}">
          </label>
          <label class="field">
            <span>Batch Size</span>
            <input type="number" min="1" data-path="embedding.providers.local-sentence-transformers.batch_size" data-kind="number" value="${escapeAttribute(String(local.batch_size))}">
          </label>
          <div class="field">
            <span>Auto Download</span>
            <label class="toggle-line"><input type="checkbox" data-path="embedding.providers.local-sentence-transformers.auto_download" ${local.auto_download ? 'checked' : ''}>允许自动下载模型</label>
          </div>
        </div>
      </div>
    </section>
  `;
}
