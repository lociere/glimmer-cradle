import type { ConfigurationDraftState } from '../configuration-state';
import { escapeAttribute, escapeHtml } from '../configuration-support';

export function renderAudioSection(draft: ConfigurationDraftState): string {
  const provider = draft.audio.tts.providers['dashscope-cosyvoice'];
  return `
    <section class="settings-section settings-card-shell" data-role="audio-section">
      <div class="settings-section-head">
        <div><span>Audio</span><h2>可选增强</h2></div>
      </div>
      <div class="settings-card settings-card-form">
        <p>默认关闭不影响服务 readiness；启用后才会校验路由与资源。</p>
        <div class="field-grid">
          <div class="field">
            <span>TTS</span>
            <label class="toggle-line"><input type="checkbox" data-path="audio.tts.enabled" ${draft.audio.tts.enabled ? 'checked' : ''}>启用语音合成</label>
          </div>
          <div class="field">
            <span>ASR</span>
            <label class="toggle-line"><input type="checkbox" data-path="audio.asr.enabled" ${draft.audio.asr.enabled ? 'checked' : ''}>启用语音识别</label>
          </div>
          <label class="field">
            <span>TTS 主路由</span>
            <input type="text" data-path="audio.tts.route.primary" value="${escapeAttribute(draft.audio.tts.route.primary)}">
          </label>
          <label class="field">
            <span>Fallbacks（逗号分隔）</span>
            <input type="text" data-path="audio.tts.route.fallbacks" data-kind="csv" value="${escapeAttribute(draft.audio.tts.route.fallbacks.join(', '))}">
          </label>
          <label class="field">
            <span>失败阈值</span>
            <input type="number" min="1" data-path="audio.tts.route.circuit_breaker.failure_threshold" data-kind="number" value="${escapeAttribute(String(draft.audio.tts.route.circuit_breaker?.failure_threshold ?? 3))}">
          </label>
          <label class="field">
            <span>恢复时间（ms）</span>
            <input type="number" min="1000" data-path="audio.tts.route.circuit_breaker.recovery_timeout_ms" data-kind="number" value="${escapeAttribute(String(draft.audio.tts.route.circuit_breaker?.recovery_timeout_ms ?? 30000))}">
          </label>
          <div class="field">
            <span>缓存</span>
            <label class="toggle-line"><input type="checkbox" data-path="audio.tts.cache.enabled" ${draft.audio.tts.cache.enabled ? 'checked' : ''}>启用音频缓存</label>
          </div>
          <label class="field">
            <span>缓存保留天数</span>
            <input type="number" min="1" data-path="audio.tts.cache.max_age_days" data-kind="number" value="${escapeAttribute(String(draft.audio.tts.cache.max_age_days ?? 30))}">
          </label>
          <div class="field">
            <span>Provider 开关</span>
            <label class="toggle-line"><input type="checkbox" data-path="audio.tts.providers.dashscope-cosyvoice.enabled" ${provider.enabled ? 'checked' : ''}>dashscope-cosyvoice</label>
          </div>
          <label class="field">
            <span>ASR 资源</span>
            <input type="text" data-path="audio.asr.resource_id" value="${escapeAttribute(draft.audio.asr.resource_id)}">
          </label>
          <label class="field field-wide">
            <span>TTS Endpoint</span>
            <input type="text" data-path="audio.tts.providers.dashscope-cosyvoice.endpoint" value="${escapeAttribute(provider.endpoint ?? '')}">
          </label>
          <label class="field">
            <span>TTS 模型</span>
            <input type="text" data-path="audio.tts.providers.dashscope-cosyvoice.model" value="${escapeAttribute(provider.model ?? '')}">
          </label>
          <label class="field">
            <span>采样率</span>
            <select data-path="audio.tts.providers.dashscope-cosyvoice.sample_rate" data-kind="number">
              ${[8000, 16000, 22050, 24000, 44100, 48000].map((rate) => `<option value="${rate}" ${provider.sample_rate === rate ? 'selected' : ''}>${rate}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>连接超时（ms）</span>
            <input type="number" min="1000" data-path="audio.tts.providers.dashscope-cosyvoice.connect_timeout_ms" data-kind="number" value="${escapeAttribute(String(provider.connect_timeout_ms ?? 5000))}">
          </label>
          <label class="field">
            <span>接收超时（ms）</span>
            <input type="number" min="1000" data-path="audio.tts.providers.dashscope-cosyvoice.receive_timeout_ms" data-kind="number" value="${escapeAttribute(String(provider.receive_timeout_ms ?? 20000))}">
          </label>
          <label class="field">
            <span>最大重试</span>
            <input type="number" min="0" max="3" data-path="audio.tts.providers.dashscope-cosyvoice.max_retries" data-kind="number" value="${escapeAttribute(String(provider.max_retries ?? 1))}">
          </label>
        </div>
      </div>
    </section>
  `;
}
