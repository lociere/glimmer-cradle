import { useCallback, useEffect, useState } from 'react';

export type WorkbenchTheme = 'dark' | 'light' | 'system';

export interface WorkbenchPreferences {
  theme: WorkbenchTheme;
  reducedMotion: boolean;
  inspectorCollapsed: boolean;
}

const STORAGE_KEY = 'glimmer-cradle.workbench.preferences.v1';
const DEFAULT_PREFERENCES: WorkbenchPreferences = {
  theme: 'dark',
  reducedMotion: false,
  inspectorCollapsed: false,
};

function readPreferences(): WorkbenchPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<WorkbenchPreferences>;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'system' ? parsed.theme : 'dark',
      reducedMotion: Boolean(parsed.reducedMotion),
      inspectorCollapsed: Boolean(parsed.inspectorCollapsed),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function resolveTheme(theme: WorkbenchTheme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useWorkbenchPreferences() {
  const [preferences, setPreferencesState] = useState<WorkbenchPreferences>(readPreferences);

  useEffect(() => {
    const root = document.body;
    root.dataset.theme = resolveTheme(preferences.theme);
    delete root.dataset.density;
    root.dataset.reducedMotion = String(preferences.reducedMotion);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    if (preferences.theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => { document.body.dataset.theme = resolveTheme('system'); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preferences.theme]);

  const setPreferences = useCallback((patch: Partial<WorkbenchPreferences>) => {
    setPreferencesState((current) => ({ ...current, ...patch }));
  }, []);

  return { preferences, setPreferences };
}
