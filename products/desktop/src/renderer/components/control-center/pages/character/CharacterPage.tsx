import React from 'react';
import type { ControlCenterSettingsController } from '../../model';
import { InfoRows, PageHeader, SurfaceCard } from '../../shared/ui';

interface CharacterPageProps {
  activeSection: string;
  settings: ControlCenterSettingsController;
  onOpenSettingsSection: (section: string) => void;
}

export const CharacterPage: React.FC<CharacterPageProps> = ({ activeSection, settings, onOpenSettingsSection }) => {
  const { draft, loadState, message } = settings;
  if (loadState === 'loading') return <SurfaceCard title="正在加载角色资料"><p className="muted-copy">正在读取当前角色偏好。</p></SurfaceCard>;
  if (loadState === 'error' || !draft) return <SurfaceCard title="角色资料加载失败"><p className="error-copy">{message || '无法读取角色资料。'}</p></SurfaceCard>;

  const keywords = draft.lifeClock.summonKeywords;
  const mode = personaModeLabel(draft.persona.personaMode);
  const characterName = draft.persona.nickname.trim() || '当前角色';
  const section = activeSection === 'persona' ? '人设基调' : activeSection === 'wake' ? '唤醒方式' : '角色资料';

  return (
    <div className="page-stack character-workbench">
      <PageHeader eyebrow="角色" title={section} summary="身份、人设与唤醒方式属于角色资料；这里展示当前状态，持久偏好统一在设置中维护。" />
      {activeSection === 'profile' && (
        <div className="character-profile-layout">
          <section className="character-identity-panel">
            <div className="character-avatar-mark" aria-hidden>{characterName.slice(0, 1)}</div>
            <div className="character-identity-copy">
              <span>当前角色</span>
              <h2>{characterName}</h2>
              <p>{mode}，角色资料、知识和长期记忆共同参与对话上下文。</p>
            </div>
          </section>
          <SurfaceCard title="资料概况">
            <InfoRows rows={[
              ['显示名称', characterName],
              ['人设模式', mode],
              ['唤醒方式', draft.lifeClock.focusOnAnyChat ? '任意聊天' : '召唤关键词'],
              ['知识连接', '角色资料库与记忆投影'],
            ]} />
            <button type="button" className="secondary-action" onClick={() => onOpenSettingsSection('character')}>编辑角色偏好</button>
          </SurfaceCard>
        </div>
      )}
      {activeSection === 'persona' && (
        <div className="character-reading-layout">
          <section className="character-reading-copy">
            <span>当前回应方式</span><h2>{mode}</h2>
            <p>基础人设由角色资料提供，经历与关系在上下文组装时按需进入，不在前端复制认知事实。</p>
          </section>
          <SurfaceCard title="上下文来源"><InfoRows rows={[
            ['身份', '角色资料'], ['稳定知识', '知识资料'], ['关系与经历', '记忆投影'], ['生成服务', '当前模型 Provider'],
          ]} /><button type="button" className="secondary-action" onClick={() => onOpenSettingsSection('character')}>编辑人设偏好</button></SurfaceCard>
        </div>
      )}
      {activeSection === 'wake' && (
        <div className="character-reading-layout">
          <section className="character-reading-copy">
            <span>当前唤醒范围</span><h2>{draft.lifeClock.focusOnAnyChat ? '任意聊天可唤醒' : '召唤关键词'}</h2>
            <div className="character-keyword-list">{keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
          </section>
          <SurfaceCard title="唤醒状态"><InfoRows rows={[
            ['关键词数量', String(keywords.length)], ['专注时长', `${Math.round(draft.lifeClock.focusDurationMs / 1000)} 秒`], ['入站防抖', `${draft.lifeClock.ingressDebounceMs} ms`],
          ]} /><button type="button" className="secondary-action" onClick={() => onOpenSettingsSection('conversation')}>编辑唤醒偏好</button></SurfaceCard>
        </div>
      )}
    </div>
  );
};

function personaModeLabel(mode: string): string {
  return ({ api: '云端会话', local_base: '本地基础', local_finetune: '本地微调' } as Record<string, string>)[mode] ?? mode;
}
