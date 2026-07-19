import type {
  AccessTokenMutationResult,
  AccessTokenSnapshot,
} from '../../../shared/api/personal-server-client';
import { escapeAttribute, escapeHtml } from '../configuration-support';

export function renderSecurityAccessSection(
  snapshot: AccessTokenSnapshot | null,
  pending: boolean,
  result: AccessTokenMutationResult | null,
): string {
  const issueNotice = result?.issued_token
    ? `
      <div class="settings-callout warning">
        <strong>新令牌明文仅显示一次</strong>
        <code data-role="issued-access-token">${escapeHtml(result.issued_token)}</code>
      </div>
    `
    : '';
  const cards = snapshot?.tokens.length
    ? snapshot.tokens.map((token) => `
      <article class="settings-card token-card" data-token-id="${escapeAttribute(token.token_id)}">
        <div class="token-card-head">
          <div>
            <strong>${escapeHtml(token.label)}</strong>
            <p>${escapeHtml(token.source)} · ${escapeHtml(token.scopes.join(', '))}</p>
          </div>
          <div class="token-card-actions">
            <button class="quiet-button" type="button" data-action="rotate-token" data-token-id="${escapeAttribute(token.token_id)}" ${token.rotatable && !pending ? '' : 'disabled'}>轮换</button>
            <button class="quiet-button danger" type="button" data-action="revoke-token" data-token-id="${escapeAttribute(token.token_id)}" ${token.revocable && !pending ? '' : 'disabled'}>撤销</button>
          </div>
        </div>
        <p>${escapeHtml(token.disabled_reason || formatTokenUsage(token.last_used_at, token.created_at))}</p>
      </article>
    `).join('')
    : '<div class="settings-empty-card"><strong>尚未创建受管访问令牌</strong><p>当前仍可在设置中创建第一枚正式访问令牌。</p></div>';

  return `
    <section class="settings-section settings-card-shell" data-role="security-access-section">
      <div class="settings-section-head">
        <div><span>安全 / 访问令牌</span><h2>控制面登录边界</h2></div>
      </div>
      <div class="settings-card">
        <strong>${escapeHtml(snapshot?.mode || 'loading')}</strong>
        <p>${escapeHtml(snapshot?.message || '正在读取访问令牌状态…')}</p>
      </div>
      ${issueNotice}
      <div class="settings-form-grid">
        <label class="field">
          <span>新令牌标签</span>
          <input type="text" data-field="access-token-label" placeholder="例如：Ops laptop" ${pending ? 'disabled' : ''}>
        </label>
        <button class="primary-button" type="button" data-action="create-token" ${pending ? 'disabled' : ''}>创建访问令牌</button>
      </div>
      <div class="settings-token-list">${cards}</div>
    </section>
  `;
}

function formatTokenUsage(lastUsedAt: string | undefined, createdAt: string): string {
  if (lastUsedAt) {
    return `最近使用：${new Date(lastUsedAt).toLocaleString()}。`;
  }
  if (createdAt === 'unknown') {
    return '该令牌由部署环境提供，当前没有可追踪的最后使用时间。';
  }
  return `创建时间：${new Date(createdAt).toLocaleString()}。`;
}
