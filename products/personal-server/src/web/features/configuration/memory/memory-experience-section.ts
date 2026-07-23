import type { ConfigurationDraftState } from '../configuration-state';
import { escapeAttribute } from '../configuration-support';

export function renderMemoryExperienceSection(draft: ConfigurationDraftState): string {
  return `
    <section class="settings-section settings-card-shell" data-role="memory-section">
      <div class="settings-section-head">
        <div><span>Memory / Experience</span><h2>上下文与经验</h2></div>
      </div>
      <div class="settings-card settings-card-form">
        <p>聊天时间线和长期 Experience 分离；这里只配置工作集、归档与检索策略。</p>
        <div class="field-grid">
          <label class="field">
            <span>工作集上限</span>
            <input type="number" min="1" data-path="memory.working.max_messages_per_conversation" data-kind="number" value="${escapeAttribute(String(draft.memory.working?.max_messages_per_conversation ?? 32))}">
          </label>
          <label class="field">
            <span>最近水合条数</span>
            <input type="number" min="1" data-path="memory.working.hydrate_recent_messages" data-kind="number" value="${escapeAttribute(String(draft.memory.working?.hydrate_recent_messages ?? 32))}">
          </label>
          <label class="field">
            <span>上下文注入上限</span>
            <input type="number" min="1" data-path="memory.working.context_message_limit" data-kind="number" value="${escapeAttribute(String(draft.memory.working?.context_message_limit ?? 8))}">
          </label>
          <label class="field">
            <span>语义权重</span>
            <input type="number" min="0" max="1" step="0.05" data-path="memory.retrieval.semantic_weight" data-kind="number" value="${escapeAttribute(String(draft.memory.retrieval?.semantic_weight ?? 0.35))}">
          </label>
          <div class="field">
            <span>Experience</span>
            <label class="toggle-line"><input type="checkbox" data-path="memory.experience.enabled" ${draft.memory.experience?.enabled ? 'checked' : ''}>启用经历归档</label>
          </div>
          <div class="field">
            <span>Consolidation</span>
            <label class="toggle-line"><input type="checkbox" data-path="memory.consolidation.enabled" ${draft.memory.consolidation?.enabled ? 'checked' : ''}>启用记忆固化</label>
          </div>
          <label class="field">
            <span>Pack 上限（MB）</span>
            <input type="number" min="1" data-path="memory.experience.pack_max_size_mb" data-kind="number" value="${escapeAttribute(String(draft.memory.experience?.pack_max_size_mb ?? 256))}">
          </label>
          <label class="field">
            <span>Flush 间隔（ms）</span>
            <input type="number" min="100" data-path="memory.experience.flush_interval_ms" data-kind="number" value="${escapeAttribute(String(draft.memory.experience?.flush_interval_ms ?? 500))}">
          </label>
          <label class="field">
            <span>检索候选数</span>
            <input type="number" min="1" data-path="memory.retrieval.candidate_limit" data-kind="number" value="${escapeAttribute(String(draft.memory.retrieval?.candidate_limit ?? 24))}">
          </label>
          <label class="field">
            <span>检索结果数</span>
            <input type="number" min="1" data-path="memory.retrieval.result_limit" data-kind="number" value="${escapeAttribute(String(draft.memory.retrieval?.result_limit ?? 6))}">
          </label>
          <label class="field">
            <span>章节空闲分钟</span>
            <input type="number" min="1" data-path="memory.conversation.chapter_idle_minutes" data-kind="number" value="${escapeAttribute(String(draft.memory.conversation?.chapter_idle_minutes ?? 360))}">
          </label>
          <label class="field">
            <span>结果 token 预算</span>
            <input type="number" min="1" data-path="memory.retrieval.token_budget" data-kind="number" value="${escapeAttribute(String(draft.memory.retrieval?.token_budget ?? 800))}">
          </label>
        </div>
      </div>
    </section>
  `;
}
