import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ControlCenterSettingsController,
  ControlCenterSettingsDraft,
  ControlCenterSettingsLoadState,
  ControlCenterSettingsSaveState,
} from './model';

export function useControlCenterSettings(): ControlCenterSettingsController {
  const [draft, setDraft] = useState<ControlCenterSettingsDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<ControlCenterSettingsDraft | null>(null);
  const [loadState, setLoadState] = useState<ControlCenterSettingsLoadState>('loading');
  const [saveState, setSaveState] = useState<ControlCenterSettingsSaveState>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    void window.desktopHost.getControlCenterSettings()
      .then((snapshot) => {
        if (cancelled) return;
        setDraft(snapshot);
        setSavedDraft(snapshot);
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDirty = useMemo(() => {
    if (!draft || !savedDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(savedDraft);
  }, [draft, savedDraft]);

  const updateDraft = useCallback((updater: (current: ControlCenterSettingsDraft) => ControlCenterSettingsDraft): void => {
    setDraft((current) => (current ? updater(current) : current));
    setSaveState('idle');
    setMessage('');
  }, []);

  const resetDraft = useCallback((nextMessage = '已恢复到上次保存的配置。'): void => {
    setDraft(savedDraft);
    setSaveState('idle');
    setMessage(nextMessage);
  }, [savedDraft]);

  const save = useCallback(async (fallbackMessage = '配置已保存。'): Promise<void> => {
    if (!draft) return;
    setSaveState('saving');
    setMessage('');
    try {
      const result = await window.desktopHost.saveControlCenterSettings(draft);
      setSavedDraft(draft);
      setSaveState('saved');
      setMessage(result.message || fallbackMessage);
    } catch (error) {
      setSaveState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [draft]);

  return {
    draft,
    savedDraft,
    loadState,
    saveState,
    message,
    isDirty,
    updateDraft,
    resetDraft,
    save,
  };
}
