import type { McpServerConfig } from '@glimmer-cradle/protocol';
import type { ConfigurationDraftState } from '../configuration-state';
import { escapeAttribute, escapeHtml } from '../configuration-support';
import type { SkillCatalogLoadResult } from '../../../shared/api/personal-server-client';

export function renderSkillsSection(
  draft: ConfigurationDraftState,
  skillCatalog: SkillCatalogLoadResult | null,
  runtimePending: boolean,
): string {
  const servers = draft.skills.mcp_servers ?? [];
  const runtimeContent = renderRuntimeProjection(skillCatalog, runtimePending);
  return `
    <section class="settings-section settings-card-shell" data-role="skills-section">
      <div class="settings-section-head">
        <div><span>Skill</span><h2>Skill Plane / MCP</h2></div>
        <div class="inline-actions">
          <button class="quiet-button" type="button" data-action="add-mcp-server">新增 MCP Server</button>
        </div>
      </div>
      <div class="settings-card settings-card-form">
        <p>这里只配置全局 Skill Plane owner。扩展私有 Skill 仍通过各自 Extension 生命周期投影，不在此伪装成管理 Skill。</p>
        <div class="field-grid">
          <div class="field">
            <span>User Skills</span>
            <label class="toggle-line"><input type="checkbox" data-path="skills.user_skills.enabled" ${draft.skills.user_skills?.enabled ? 'checked' : ''}>启用用户技能目录</label>
          </div>
          <label class="field">
            <span>根目录</span>
            <input type="text" data-path="skills.user_skills.root_dir" value="${escapeAttribute(draft.skills.user_skills?.root_dir ?? 'skills')}">
          </label>
        </div>
        <div class="settings-mcp-list">
          ${servers.length > 0 ? servers.map((server, index) => renderMcpServer(server, index)).join('') : `
            <div class="settings-empty-card">
              <strong>尚未配置 MCP Server</strong>
              <p>零 Provider / 零 MCP 是合法最小状态。需要外部能力时再按产品兼容性显式接入。</p>
            </div>
          `}
        </div>
        <div class="settings-runtime-block">
          <div class="settings-section-head compact">
            <div><span>Runtime</span><h3>Skill Catalog / Provider Runtime</h3></div>
          </div>
          ${runtimeContent}
        </div>
      </div>
    </section>
  `;
}

function renderMcpServer(server: McpServerConfig, index: number): string {
  return `
    <article class="settings-mcp-card">
      <div class="settings-section-head compact">
        <div><span>MCP Server</span><h3>${escapeHtml(server.id || `server-${index + 1}`)}</h3></div>
        <button class="quiet-button" type="button" data-action="remove-mcp-server" data-server-index="${index}">删除</button>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>ID</span>
          <input type="text" data-path="skills.mcp_servers.${index}.id" value="${escapeAttribute(server.id)}">
        </label>
        <label class="field">
          <span>Transport</span>
          <select data-path="skills.mcp_servers.${index}.transport">
            <option value="stdio" ${server.transport === 'stdio' ? 'selected' : ''}>stdio</option>
            <option value="http" ${server.transport === 'http' ? 'selected' : ''}>http</option>
            <option value="websocket" ${server.transport === 'websocket' ? 'selected' : ''}>websocket</option>
          </select>
        </label>
        <div class="field">
          <span>启用</span>
          <label class="toggle-line"><input type="checkbox" data-path="skills.mcp_servers.${index}.enabled" ${server.enabled ? 'checked' : ''}>参与 Skill Plane</label>
        </div>
        <label class="field">
          <span>Products（逗号分隔）</span>
          <input type="text" data-path="skills.mcp_servers.${index}.products" data-kind="csv" value="${escapeAttribute((server.products ?? []).join(', '))}">
        </label>
        <label class="field">
          <span>Command</span>
          <input type="text" data-path="skills.mcp_servers.${index}.command" value="${escapeAttribute(server.command ?? '')}">
        </label>
        <label class="field">
          <span>Capability Prefix</span>
          <input type="text" data-path="skills.mcp_servers.${index}.capability_prefix" value="${escapeAttribute(server.capability_prefix ?? '')}">
        </label>
        <label class="field field-wide">
          <span>URL</span>
          <input type="text" data-path="skills.mcp_servers.${index}.url" value="${escapeAttribute(server.url ?? '')}">
        </label>
        <label class="field field-wide">
          <span>Args（每行一个）</span>
          <textarea data-path="skills.mcp_servers.${index}.args" data-kind="lines">${escapeHtml((server.args ?? []).join('\n'))}</textarea>
        </label>
        <label class="field field-wide">
          <span>Env（每行 KEY=VALUE）</span>
          <textarea data-path="skills.mcp_servers.${index}.env" data-kind="env-lines">${escapeHtml(Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'))}</textarea>
        </label>
        <label class="field">
          <span>Timeout（ms）</span>
          <input type="number" min="0" data-path="skills.mcp_servers.${index}.timeout_ms" data-kind="number" value="${escapeAttribute(String(server.timeout_ms ?? 30000))}">
        </label>
      </div>
    </article>
  `;
}

function renderRuntimeProjection(
  skillCatalog: SkillCatalogLoadResult | null,
  runtimePending: boolean,
): string {
  if (runtimePending && !skillCatalog) {
    return `
      <div class="settings-empty-card">
        <strong>正在读取 Skill Plane runtime</strong>
        <p>配置 owner 与运行时目录分离：当前正在通过受控 surface 请求 provider runtime 与能力目录投影。</p>
      </div>
    `;
  }

  if (!skillCatalog) {
    return `
      <div class="settings-empty-card">
        <strong>尚未获取 Skill Plane runtime</strong>
        <p>连接到 Kernel 后会在这里显示 provider runtime、私有 Skill 可见范围和 disabled reason。</p>
      </div>
    `;
  }

  if (skillCatalog.status !== 'success' || !skillCatalog.snapshot) {
    return `
      <div class="settings-empty-card">
        <strong>Skill Catalog 读取失败</strong>
        <p>${escapeHtml(skillCatalog.message || '当前无法读取 Skill Plane runtime。')}</p>
      </div>
    `;
  }

  const snapshot = skillCatalog.snapshot;
  return `
    <div class="settings-runtime-summary-grid">
      <div class="settings-card">
        <span>技能总数</span>
        <strong>${snapshot.totalSkills}</strong>
        <p>${snapshot.totalTools} 个工具，${snapshot.totalResources} 个资源，${snapshot.totalPrompts} 个 prompt。</p>
      </div>
      <div class="settings-card">
        <span>Runtime 状态</span>
        <strong>ready ${snapshot.runtimeStatusCounts.ready} / contract_only ${snapshot.runtimeStatusCounts.contract_only}</strong>
        <p>contract_only 表示契约存在但 provider 尚未运行，不会被伪装成可执行 ready Skill。</p>
      </div>
    </div>
    <div class="settings-runtime-list">
      ${snapshot.providerRuntimes.map((runtime) => `
        <article class="settings-runtime-card">
          <div class="settings-section-head compact">
            <div>
              <span>${escapeHtml(runtime.provider.kind)}</span>
              <h3>${escapeHtml(runtime.display_name || runtime.provider.id)}</h3>
            </div>
            <strong>${escapeHtml(runtime.state)}</strong>
          </div>
          <p>${escapeHtml(runtime.summary)}</p>
          <p>Skills ${runtime.skill_count} / Tools ${runtime.tool_count} / Resources ${runtime.resource_count}</p>
          ${runtime.error ? `<p>错误：${escapeHtml(runtime.error)}</p>` : ''}
          ${Array.isArray(runtime.recovery_actions) && runtime.recovery_actions.length > 0
            ? `<p>恢复建议：${escapeHtml(runtime.recovery_actions.join(' / '))}</p>`
            : ''}
        </article>
      `).join('')}
      <div class="settings-skill-entry-list">
        ${snapshot.entries.map((entry) => `
          <article class="settings-skill-entry">
            <div class="settings-section-head compact">
              <div>
                <span>${escapeHtml(entry.provider.kind)} / ${escapeHtml(formatCapabilityScope(entry.scope))}</span>
                <h3>${escapeHtml(entry.name)}</h3>
              </div>
              <strong>${escapeHtml(String(entry.metadata?.runtime_status ?? 'ready'))}</strong>
            </div>
            <p>${escapeHtml(entry.description)}</p>
            <p>Audience: ${escapeHtml(entry.audience)} · Tools ${entry.tools.length} · Resources ${entry.resources.length} · Prompts ${entry.prompts.length}</p>
            <p>Risk: ${escapeHtml(entry.policy.riskLevel)} · Confirm: ${entry.policy.confirmationRequired ? 'yes' : 'no'} · Audit: ${entry.policy.audit ? 'yes' : 'no'}</p>
            ${entry.metadata?.visibility ? `<p>可见性：${escapeHtml(String(entry.metadata.visibility))}</p>` : ''}
            ${entry.metadata?.readiness_reason ? `<p>Disabled reason: ${escapeHtml(String(entry.metadata.readiness_reason))}</p>` : ''}
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

function formatCapabilityScope(scope: { kind: string; ids?: readonly string[] }): string {
  if (scope.kind === 'global') {
    return 'global';
  }
  const suffix = Array.isArray(scope.ids) && scope.ids.length > 0
    ? `:${scope.ids.join(',')}`
    : '';
  return `${scope.kind}${suffix}`;
}
