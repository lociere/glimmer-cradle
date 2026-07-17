import React, { useEffect, useMemo, useState } from 'react';
import type { ControlCenterSettingsController, ControlCenterSettingsDraft } from '../../model';
import { InfoRows, NumberField, PageHeader, SelectControl, SelectField, SurfaceCard, TextAreaField, TextField } from '../../shared/ui';
import type { WorkbenchPreferences, WorkbenchTheme } from '../../workbench/useWorkbenchPreferences';

type ModelProvider = ControlCenterSettingsDraft['modelServices']['providers'][number];

interface SettingsPageProps {
  activeSection: string;
  settings: ControlCenterSettingsController;
  preferences: WorkbenchPreferences;
  onPreferencesChange: (patch: Partial<WorkbenchPreferences>) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ activeSection, settings, preferences, onPreferencesChange }) => {
  const { draft, savedDraft, loadState, saveState, message, isDirty, updateDraft, resetDraft, save } = settings;
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!draft) return;
    if (!draft.modelServices.providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(draft.modelServices.activeProviderId || draft.modelServices.providers[0]?.id || '');
    }
  }, [draft, selectedProviderId]);

  const selectedProvider = useMemo(() => draft?.modelServices.providers.find((provider) => provider.id === selectedProviderId) ?? null, [draft, selectedProviderId]);
  if (loadState === 'loading') return <SurfaceCard><p className="muted-copy">正在读取设置。</p></SurfaceCard>;
  if (loadState === 'error' || !draft) return <SurfaceCard><p className="error-copy">{message || '设置读取失败。'}</p></SurfaceCard>;

  return (
    <div className="settings-layout">
      <header className="settings-page-head">
        <PageHeader eyebrow="设置" title={settingsSectionTitle(activeSection)} summary="持久偏好只在这里编辑；运行状态、能力目录与角色投影保持只读。" status={{ label: isDirty ? '待保存' : '已同步', tone: isDirty ? 'warn' : 'ready' }} />
        <div className="settings-save-bar">
          <div><strong>{isDirty ? '有未保存改动' : '设置已同步'}</strong><span>{message || saveStateLabel(saveState)}</span></div>
          <button type="button" className="secondary-action" disabled={!isDirty || saveState === 'saving' || !savedDraft} onClick={() => resetDraft()}>重置</button>
          <button type="button" className="primary-action" disabled={!isDirty || saveState === 'saving'} onClick={() => { void save(); }}>{saveState === 'saving' ? '保存中' : '保存设置'}</button>
        </div>
      </header>

      {activeSection === 'general' && <SettingsSection title="通用" subtitle="工作台入口与设置边界">
        <div className="settings-overview-list">
          <SettingRow label="工作台主题" value={themeLabel(preferences.theme)} detail="固定舒适布局" />
          <SettingRow label="模型服务" value={draft.modelServices.activeProviderId || '未选择'} detail={`${draft.modelServices.providers.length} 个 Provider`} />
          <SettingRow label="语义向量" value={draft.embedding.enabled ? '已启用' : '未启用'} detail={draft.embedding.enabled ? draft.embedding.provider : '基础召回'} />
          <SettingRow label="语音" value={`${draft.audio.ttsEnabled ? '生成开' : '生成关'} / ${draft.audio.asrEnabled ? '识别开' : '识别关'}`} detail={draft.audio.cloudVoiceId || '未绑定云端声线'} />
          <SettingRow label="形象" value={draft.avatar.enabled ? '已开启' : '已关闭'} detail="内部端点自动治理" />
        </div>
      </SettingsSection>}

      {activeSection === 'workbench' && <SettingsSection title="外观" subtitle="主题与动态效果">
        <div className="theme-choice-group" role="radiogroup" aria-label="主题">
          {([['dark', '深色', '专注工作台'], ['light', '浅色', '明亮清晰'], ['system', '跟随系统', '自动切换']] as const).map(([value, label, detail]) => (
            <button type="button" role="radio" aria-checked={preferences.theme === value} className={`theme-choice ${preferences.theme === value ? 'is-selected' : ''}`} key={value} onClick={() => onPreferencesChange({ theme: value })}>
              <span className={`theme-choice-preview theme-preview-${value}`} aria-hidden><i /><i /><i /></span><strong>{label}</strong><em>{detail}</em>
            </button>
          ))}
        </div>
        <div className="settings-form-grid settings-form-single">
          <SettingToggle label="减少动态效果" description="降低切换和悬浮动画" checked={preferences.reducedMotion} onChange={(value) => onPreferencesChange({ reducedMotion: value })} />
        </div>
      </SettingsSection>}

      {activeSection === 'conversation' && <SettingsSection title="对话" subtitle="生成倾向与注意力节拍">
        <div className="settings-form-grid">
          <NumberField label="最大 token" min={64} max={8192} step={64} value={draft.inference.maxTokens} onChange={(value) => updateDraft((current) => ({ ...current, inference: { ...current.inference, maxTokens: value } }))} />
          <NumberField label="温度" min={0} max={2} step={0.05} value={draft.inference.temperature} onChange={(value) => updateDraft((current) => ({ ...current, inference: { ...current.inference, temperature: value } }))} />
          <NumberField label="Top P" min={0} max={1} step={0.05} value={draft.inference.topP} onChange={(value) => updateDraft((current) => ({ ...current, inference: { ...current.inference, topP: value } }))} />
          <SettingToggle label="主动思维节拍" description="允许本地注意力按节拍更新" checked={draft.lifeClock.heartbeatEnabled} onChange={(value) => updateDraft((current) => ({ ...current, lifeClock: { ...current.lifeClock, heartbeatEnabled: value } }))} />
          <NumberField label="节拍间隔（ms）" min={1000} max={600000} step={500} value={draft.lifeClock.heartbeatIntervalMs} onChange={(value) => updateDraft((current) => ({ ...current, lifeClock: { ...current.lifeClock, heartbeatIntervalMs: value } }))} />
          <NumberField label="入站防抖（ms）" min={0} max={60000} step={100} value={draft.lifeClock.ingressDebounceMs} onChange={(value) => updateDraft((current) => ({ ...current, lifeClock: { ...current.lifeClock, ingressDebounceMs: value } }))} />
          <SettingToggle label="任意聊天唤醒" description="所有会话都可以进入专注态" checked={draft.lifeClock.focusOnAnyChat} onChange={(value) => updateDraft((current) => ({ ...current, lifeClock: { ...current.lifeClock, focusOnAnyChat: value } }))} />
        </div>
        <TextAreaField label="召唤关键词" value={draft.lifeClock.summonKeywords.join('\n')} rows={4} onChange={(value) => updateDraft((current) => ({ ...current, lifeClock: { ...current.lifeClock, summonKeywords: value.split('\n').map((item) => item.trim()).filter(Boolean) } }))} />
      </SettingsSection>}

      {activeSection === 'model-services' && <SettingsSection title="模型 Provider" subtitle="新增、编辑和选择当前模型服务">
        <div className="provider-toolbar"><div className="provider-active-select"><span>当前 Provider</span><SelectControl ariaLabel="当前 Provider" value={draft.modelServices.activeProviderId} options={draft.modelServices.providers.map((provider) => provider.id)} onChange={(value) => updateDraft((current) => ({ ...current, modelServices: { ...current.modelServices, activeProviderId: value } }))} /></div><button type="button" className="primary-action" onClick={() => setCreateOpen(true)}>新建</button></div>
        <div className="provider-manager">
          <aside className="provider-list">{draft.modelServices.providers.map((provider) => <button type="button" aria-current={provider.id === selectedProviderId ? 'true' : undefined} key={provider.id} onClick={() => setSelectedProviderId(provider.id)}><span className="provider-body"><strong className="provider-name">{provider.id}</strong><span className="provider-message">{provider.models.chat || '未配置对话模型'}</span></span>{provider.id === draft.modelServices.activeProviderId && <em>当前</em>}</button>)}</aside>
          <section className="provider-detail">
            {selectedProvider ? <ProviderEditor provider={selectedProvider} updateDraft={updateDraft} onIdChange={setSelectedProviderId} onDelete={() => deleteProvider(draft, selectedProvider.id, updateDraft, setSelectedProviderId)} /> : <p className="muted-copy">新建一个 Provider 开始配置。</p>}
          </section>
        </div>
        <p className="provider-secret-boundary">API Key 只从环境变量或 configs/secrets 读取，工作台不会读取或回显密钥。</p>
        <div className="settings-form-grid">
          <SettingToggle label="语义向量增强" description="基础召回无需开启；启用后增加语义相似度" checked={draft.embedding.enabled} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, enabled: value } }))} />
          <SelectField label="Embedding Provider" value={draft.embedding.provider} options={[{ value: 'dashscope-text-embedding', label: 'DashScope 云端' }, { value: 'local-sentence-transformers', label: '本地 Sentence Transformers' }]} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, provider: value } }))} />
          {draft.embedding.provider === 'dashscope-text-embedding' ? <>
            <TextField label="云端模型" value={draft.embedding.cloudModel} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, cloudModel: value } }))} />
            <SelectField label="向量维度" value={String(draft.embedding.dimensions)} options={[64, 128, 256, 512, 768, 1024, 1536, 2048].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, dimensions: Number(value) } }))} />
          </> : <>
            <TextField label="模型目录" value={draft.embedding.modelPath} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, modelPath: value } }))} />
            <TextField label="模型 ID" value={draft.embedding.modelId} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, modelId: value } }))} />
            <TextField label="计算设备" value={draft.embedding.device} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, device: value } }))} />
            <SettingToggle label="允许下载本地模型" description="仅首次需要，模型保存到用户数据目录" checked={draft.embedding.autoDownload} onChange={(value) => updateDraft((current) => ({ ...current, embedding: { ...current.embedding, autoDownload: value } }))} />
          </>}
        </div>
      </SettingsSection>}

      {activeSection === 'voice' && <SettingsSection title="语音服务" subtitle="云端语音、角色声线与本地识别">
        <div className="settings-form-grid">
          <SettingToggle label="语音生成" description="允许回复生成语音" checked={draft.audio.ttsEnabled} onChange={(value) => updateDraft((current) => ({ ...current, audio: { ...current.audio, ttsEnabled: value } }))} />
          <SettingToggle label="语音识别" description="允许麦克风输入转写" checked={draft.audio.asrEnabled} onChange={(value) => updateDraft((current) => ({ ...current, audio: { ...current.audio, asrEnabled: value } }))} />
          <TextField label="云端声线 ID" value={draft.audio.cloudVoiceId} onChange={(value) => updateDraft((current) => ({ ...current, audio: { ...current.audio, cloudVoiceId: value } }))} />
        </div>
      </SettingsSection>}

      {activeSection === 'character' && <SettingsSection title="角色" subtitle="称呼与人设模式">
        <div className="settings-form-grid"><TextField label="显示名称" value={draft.persona.nickname} onChange={(value) => updateDraft((current) => ({ ...current, persona: { ...current.persona, nickname: value } }))} /><SelectField label="人设模式" value={draft.persona.personaMode} options={[{ value: 'api', label: '云端会话' }, { value: 'local_base', label: '本地基础' }, { value: 'local_finetune', label: '本地微调' }]} onChange={(value) => updateDraft((current) => ({ ...current, persona: { ...current.persona, personaMode: value } }))} /></div>
      </SettingsSection>}

      {activeSection === 'privacy' && <SettingsSection title="隐私与权限" subtitle="密钥、扩展权限和用户确认">
        <InfoRows rows={[["Provider 密钥", '只从环境变量或 secrets 读取'], ['扩展权限', '在能力页按扩展查看'], ['高风险技能', '调用前要求用户确认'], ['日志入口', '只开放预定义位置']]} />
      </SettingsSection>}

      {activeSection === 'data' && <SettingsSection title="数据" subtitle="不同数据由各自 owner 持久化">
        <InfoRows rows={[["会话记录", 'Conversation Store'], ['经历与长期记忆', 'Cognition 数据层'], ['界面偏好', '工作台本地偏好'], ['形象动作状态', 'Avatar 权威状态']]} />
      </SettingsSection>}

      {activeSection === 'advanced' && <SettingsSection title="高级" subtitle="本机资源与通信边界">
        <InfoRows rows={[["内部通信", '由系统自动分配回环端点'], ['端点目录', 'data/run/host/endpoints.json'], ['外部网络', '仅由已授权 Provider 或 Extension 使用']]} />
      </SettingsSection>}

      {createOpen && <div className="modal-backdrop" onMouseDown={() => setCreateOpen(false)}><section className="dialog-panel" role="dialog" aria-modal="true" aria-label="新建 Provider" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-head"><div><span>模型服务</span><h2>新建 Provider</h2></div><button type="button" className="icon-button" aria-label="关闭" onClick={() => setCreateOpen(false)}>×</button></div><p className="muted-copy">创建后在详情中填写 API 类型、地址和模型名。</p><div className="card-actions"><button type="button" className="secondary-action" onClick={() => setCreateOpen(false)}>取消</button><button type="button" className="primary-action" onClick={() => { const id = createProvider(draft, updateDraft); setSelectedProviderId(id); setCreateOpen(false); }}>创建 Provider</button></div></section></div>}
    </div>
  );
};

const SettingsSection: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({ title, subtitle, children }) => <section className="settings-section"><div className="settings-section-head"><div><strong>{title}</strong><p>{subtitle}</p></div><span>本机偏好</span></div><div className="settings-section-body">{children}</div></section>;
const SettingRow: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => <div className="settings-overview-item"><span>{label}</span><strong>{value}</strong><em>{detail}</em></div>;
const SettingToggle: React.FC<{ label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }> = ({ label, description, checked, onChange }) => <label className={`setting-toggle ${checked ? 'is-on' : ''}`}><span className="setting-toggle-copy"><strong>{label}</strong><em>{description}</em></span><input type="checkbox" checked={checked} aria-label={label} onChange={(event) => onChange(event.target.checked)} /><span className="setting-toggle-track" aria-hidden><span /></span></label>;

const ProviderEditor: React.FC<{ provider: ModelProvider; updateDraft: ControlCenterSettingsController['updateDraft']; onIdChange: (id: string) => void; onDelete: () => void }> = ({ provider, updateDraft, onIdChange, onDelete }) => {
  const update = (updater: (current: ModelProvider) => ModelProvider): void => updateProvider(updateDraft, provider.id, updater);
  return <div className="provider-editor"><div className="provider-editor-head span-two"><div><span>Provider</span><h3>{provider.id}</h3></div><button type="button" className="danger-action" onClick={onDelete}>删除</button></div><TextField label="Provider ID" value={provider.id} onChange={(value) => { update((current) => ({ ...current, id: value })); onIdChange(value); }} /><TextField label="API 类型" value={provider.apiType} onChange={(value) => update((current) => ({ ...current, apiType: value }))} /><TextField label="Base URL" value={provider.baseUrl} onChange={(value) => update((current) => ({ ...current, baseUrl: value }))} /><NumberField label="温度" min={0} max={2} step={0.05} value={provider.temperature} onChange={(value) => update((current) => ({ ...current, temperature: value }))} /><TextField label="对话模型" value={provider.models.chat} onChange={(value) => update((current) => ({ ...current, models: { ...current.models, chat: value } }))} /><TextField label="推理模型" value={provider.models.reasoner} onChange={(value) => update((current) => ({ ...current, models: { ...current.models, reasoner: value } }))} /><TextField label="视觉模型" value={provider.models.vision} onChange={(value) => update((current) => ({ ...current, models: { ...current.models, vision: value } }))} /><TextField label="音频模型" value={provider.models.audio} onChange={(value) => update((current) => ({ ...current, models: { ...current.models, audio: value } }))} /></div>;
};

function updateProvider(updateDraft: ControlCenterSettingsController['updateDraft'], id: string, updater: (provider: ModelProvider) => ModelProvider): void { updateDraft((current) => ({ ...current, modelServices: { ...current.modelServices, providers: current.modelServices.providers.map((provider) => provider.id === id ? updater(provider) : provider), activeProviderId: current.modelServices.activeProviderId === id ? updater(current.modelServices.providers.find((provider) => provider.id === id)!).id : current.modelServices.activeProviderId } })); }
function createProvider(draft: ControlCenterSettingsDraft, updateDraft: ControlCenterSettingsController['updateDraft']): string { let index = draft.modelServices.providers.length + 1; let id = `provider-${index}`; while (draft.modelServices.providers.some((provider) => provider.id === id)) { index += 1; id = `provider-${index}`; } const provider: ModelProvider = { id, apiType: 'openai_compatible', baseUrl: '', temperature: 0.7, models: { chat: '', reasoner: '', vision: '', audio: '' } }; updateDraft((current) => ({ ...current, modelServices: { ...current.modelServices, providers: [...current.modelServices.providers, provider], activeProviderId: current.modelServices.activeProviderId || id } })); return id; }
function deleteProvider(draft: ControlCenterSettingsDraft, id: string, updateDraft: ControlCenterSettingsController['updateDraft'], select: (id: string) => void): void { const remaining = draft.modelServices.providers.filter((provider) => provider.id !== id); const nextId = remaining[0]?.id || ''; updateDraft((current) => ({ ...current, modelServices: { ...current.modelServices, providers: current.modelServices.providers.filter((provider) => provider.id !== id), activeProviderId: current.modelServices.activeProviderId === id ? nextId : current.modelServices.activeProviderId } })); select(nextId); }
function settingsSectionTitle(section: string): string { return ({ general: '通用', workbench: '外观', conversation: '对话', 'model-services': '模型 Provider', voice: '语音服务', character: '角色', privacy: '隐私与权限', data: '数据', advanced: '高级' } as Record<string, string>)[section] ?? '设置'; }
function themeLabel(theme: WorkbenchTheme): string { return theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统'; }
function saveStateLabel(state: string): string { return ({ idle: '等待修改', saving: '正在保存', saved: '已保存', error: '保存失败' } as Record<string, string>)[state] ?? state; }
