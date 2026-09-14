import { createContext, useContext, type ReactNode } from 'react';

export type ThemePreference = 'dark' | 'light';
export type BackgroundPreference = 'ambient' | 'wallpaper';
export interface AppearancePreferences {
  readonly theme: ThemePreference;
  readonly background: BackgroundPreference;
}

export interface AppearanceContextValue extends AppearancePreferences {
  readonly update: <Key extends keyof AppearancePreferences>(key: Key, value: AppearancePreferences[Key]) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ value, children }: { readonly value: AppearanceContextValue; readonly children: ReactNode }): JSX.Element {
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('AppearanceProvider is required');
  return value;
}
