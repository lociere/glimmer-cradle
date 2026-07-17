import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConversationPage } from './pages/conversation/ConversationPage';
import { useAppStore } from '../../store/appStore';
import { useEmotionStore } from '../../store/emotionStore';
import { ControlCenterShell } from './workbench/ControlCenterShell';
import { defaultControlCenterSection } from './workbench/navigation';
import { useWorkbenchPreferences } from './workbench/useWorkbenchPreferences';
import { useControlCenterSettings } from './useControlCenterSettings';
import { AvatarPage } from './pages/avatar/AvatarPage';
import { CapabilitiesPage } from './pages/capabilities/CapabilitiesPage';
import { CharacterPage } from './pages/character/CharacterPage';
import { MemoryPage } from './pages/memory/MemoryPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { LogsPage } from './pages/logs/LogsPage';
import {
  STATUS_LABELS,
  deriveAvatarReady,
  deriveHealth,
  deriveAvatarLabel,
  pageById,
  type ControlCenterPage,
} from './model';

export const ControlCenter: React.FC = () => {
  const [activePage, setActivePage] = useState<ControlCenterPage>('chat');
  const [activeSection, setActiveSection] = useState(defaultControlCenterSection('chat'));
  const [appearanceSaveState, setAppearanceSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [appearanceSaveMessage, setAppearanceSaveMessage] = useState('');
  const systemStatus = useAppStore((s) => s.systemStatus);
  const avatarRenderState = useAppStore((s) => s.avatarRenderState);
  const currentAvatarModel = useAppStore((s) => s.currentAvatarModel);
  const avatarAppearance = useAppStore((s) => s.avatarAppearance);
  const presentationProjection = useAppStore((s) => s.characterPresentationProjection);
  const runtimeReadinessCatalog = useAppStore((s) => s.runtimeReadinessCatalog);
  const setAvatarAppearance = useAppStore((s) => s.setAvatarAppearance);
  const audioStatus = useAppStore((s) => s.audioStatus);
  const messages = useAppStore((s) => s.messages);
  const thought = useAppStore((s) => s.thought);
  const audioInput = useAppStore((s) => s.audioInput);
  const lastEmotion = useEmotionStore((s) => s.lastEmotion);
  const settings = useControlCenterSettings();
  const { preferences, setPreferences } = useWorkbenchPreferences();
  const appearanceTimer = useRef<number | null>(null);
  const pendingAppearance = useRef<typeof avatarAppearance | null>(null);

  const flushAppearance = useCallback(() => {
    const next = pendingAppearance.current;
    pendingAppearance.current = null;
    if (appearanceTimer.current !== null) {
      window.clearTimeout(appearanceTimer.current);
      appearanceTimer.current = null;
    }
    if (next) {
      setAppearanceSaveState('saving');
      setAppearanceSaveMessage('');
      void window.desktopHost.setAvatarAppearance(next)
        .then(() => {
          setAppearanceSaveState('saved');
          setAppearanceSaveMessage('形象设置已保存。');
          window.setTimeout(() => {
            setAppearanceSaveState((current) => (current === 'saved' ? 'idle' : current));
          }, 1800);
        })
        .catch((error: unknown) => {
          setAppearanceSaveState('error');
          setAppearanceSaveMessage(error instanceof Error ? error.message : '形象设置保存失败');
        });
    }
  }, []);

  useEffect(() => {
    const flushBeforeUnload = (): void => flushAppearance();
    window.addEventListener('beforeunload', flushBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', flushBeforeUnload);
      flushAppearance();
    };
  }, [flushAppearance]);

  const currentPage = pageById(activePage);
  const statusLabel = STATUS_LABELS[systemStatus] ?? systemStatus;
  const avatarLabel = useMemo(
    () => deriveAvatarLabel(avatarRenderState, presentationProjection, runtimeReadinessCatalog),
    [avatarRenderState, presentationProjection, runtimeReadinessCatalog],
  );
  const avatarReady = useMemo(
    () => deriveAvatarReady(presentationProjection, runtimeReadinessCatalog),
    [presentationProjection, runtimeReadinessCatalog],
  );
  const currentAvatarModelLabel = presentationProjection?.display_name ?? '';
  const characterName = settings.draft?.persona.nickname.trim() || '当前角色';
  const emotion = lastEmotion?.emotion_type ?? 'neutral';
  const health = useMemo(
    () => deriveHealth(systemStatus, audioStatus, runtimeReadinessCatalog),
    [audioStatus, runtimeReadinessCatalog, systemStatus],
  );
  const handleNavigateToSection = useCallback((page: ControlCenterPage, section?: string) => {
    flushAppearance();
    setActivePage(page);
    setActiveSection(section ?? defaultControlCenterSection(page));
  }, [flushAppearance]);
  const handleNavigate = useCallback((page: ControlCenterPage) => {
    handleNavigateToSection(page);
  }, [handleNavigateToSection]);

  return (
    <ControlCenterShell
      activePage={activePage}
      activeSection={activeSection}
      currentPage={currentPage}
      systemStatus={systemStatus}
      avatarLabel={avatarLabel}
      characterName={characterName}
      preferences={preferences}
      onPreferencesChange={setPreferences}
      onNavigate={handleNavigate}
      onSectionChange={setActiveSection}
    >
      {activePage === 'chat' && <ConversationPage activeSection={activeSection} />}
      {activePage === 'character' && !activeSection.startsWith('avatar-') && activeSection !== 'voice' && (
        <CharacterPage
          activeSection={activeSection}
          settings={settings}
          onOpenSettingsSection={(section) => handleNavigateToSection('settings', section)}
        />
      )}
      {activePage === 'character' && activeSection === 'voice' && (
        <section className="character-voice-summary">
          <header><span>角色声音</span><h1>声音</h1><p>角色声线与语音服务分离管理，当前页面只展示{characterName}正在使用的声音。</p></header>
          <div className="surface-card"><strong>当前声线</strong><span>{settings.draft?.audio.cloudVoiceId || '尚未绑定云端声线'}</span><button type="button" className="primary-action" onClick={() => handleNavigateToSection('settings', 'voice')}>管理语音服务</button></div>
        </section>
      )}
      {activePage === 'memory' && <MemoryPage activeSection={activeSection} />}
      {activePage === 'settings' && <SettingsPage activeSection={activeSection} settings={settings} preferences={preferences} onPreferencesChange={setPreferences} />}
      {activePage === 'capabilities' && (
        <CapabilitiesPage
          audioStatus={audioStatus}
          audioInputStatus={audioInput.status}
          activeSection={activeSection}
          onOpenAudioSettings={() => handleNavigateToSection('settings', 'voice')}
        />
      )}
      {activePage === 'character' && activeSection.startsWith('avatar-') && (
        <AvatarPage
          avatarLabel={avatarLabel}
          currentAvatarModel={currentAvatarModel}
          currentAvatarModelLabel={currentAvatarModelLabel}
          emotion={emotion}
          appearance={avatarAppearance}
          presentationProjection={presentationProjection}
          runtimeReadinessCatalog={runtimeReadinessCatalog}
          activeSection={{ 'avatar-status': 'status', 'avatar-model': 'model', 'avatar-placement': 'placement' }[activeSection] ?? 'status'}
          onAppearanceChange={(next, mode = 'commit') => {
            setAvatarAppearance(next);
            pendingAppearance.current = next;
            setAppearanceSaveState(mode === 'commit' ? 'saving' : 'idle');
            setAppearanceSaveMessage('');
            if (mode === 'commit') {
              flushAppearance();
              return;
            }
            if (appearanceTimer.current === null) {
              appearanceTimer.current = window.setTimeout(flushAppearance, 120);
            }
          }}
        />
      )}
      {activePage === 'logs' && (
        <LogsPage
          health={health}
          activeSection={activeSection}
          runtimeReadinessCatalog={runtimeReadinessCatalog}
          onSectionChange={setActiveSection}
        />
      )}
    </ControlCenterShell>
  );
};
