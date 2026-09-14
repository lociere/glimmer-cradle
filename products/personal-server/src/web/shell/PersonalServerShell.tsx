import { useEffect, useState } from 'react';
import {
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay, Popover } from 'react-aria-components';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type {
  PersonalServerAppController,
  PersonalServerAppSnapshot,
} from '../app/PersonalServerAppController';
import {
  AppearanceProvider,
  type AppearancePreferences,
} from '../shared/ui/Appearance/AppearanceContext';
import styles from './PersonalServerShell.module.css';

interface NavigationItem {
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly matches: readonly string[];
}

const navigationItems: readonly NavigationItem[] = [
  { path: '/config', label: '配置', description: '系统如何运行', matches: ['/config'] },
  { path: '/extensions', label: '扩展', description: '管理扩展包与生命周期', matches: ['/extensions'] },
  { path: '/capabilities', label: '能力', description: '查看当前可用能力', matches: ['/capabilities'] },
  { path: '/data', label: '数据', description: '查看持久内容', matches: ['/data'] },
  { path: '/system', label: '系统', description: '运行、日志与维护', matches: ['/system'] },
];

export function PersonalServerShell(props: {
  readonly controller: PersonalServerAppController;
  readonly snapshot: PersonalServerAppSnapshot;
}): JSX.Element {
  const location = useLocation();
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => preferredAppearance());
  const current = navigationItems.find((item) => item.matches.some((path) => location.pathname.startsWith(path)));

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = appearance.theme;
    root.dataset.background = appearance.background;
    root.dataset.material = 'frosted';
    root.dataset.density = 'compact';
    root.dataset.motion = 'full';
    root.style.colorScheme = appearance.theme;
    window.localStorage.setItem('personal-server-appearance', JSON.stringify(appearance));
    window.localStorage.setItem('personal-server-theme', appearance.theme);
  }, [appearance]);

  useEffect(() => {
    document.title = `${current?.label ?? '未知路由'} · 微光摇篮 Personal Server`;
  }, [current]);

  const appearanceValue = {
    ...appearance,
    update: <Key extends keyof AppearancePreferences>(key: Key, value: AppearancePreferences[Key]) => setAppearance((current) => ({ ...current, [key]: value })),
  };

  return (
    <AppearanceProvider value={appearanceValue}>
    <div className={styles.shell} data-role="app-shell">
      <Navigation />
      <div className={styles.desktopTools} role="toolbar" aria-label="全局工具">
        <AppearanceMenu appearance={appearanceValue} />
        <button className={styles.iconButton} type="button" aria-label="退出登录" onClick={() => void props.controller.logout()}>
          <LogOut aria-hidden="true" size={17} />
        </button>
      </div>
      <header className={styles.mobileBar}>
        <div className={styles.mobileIdentity}>
          <MobileNavigation onLogout={() => void props.controller.logout()} />
          <strong>{current?.label ?? '未知路由'}</strong>
        </div>
        <div className={styles.globalActions}>
          <AppearanceMenu appearance={appearanceValue} />
        </div>
      </header>
      <main className={styles.workspace} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
    </AppearanceProvider>
  );
}

function Navigation({ onNavigate }: { readonly onNavigate?: () => void }): JSX.Element {
  const location = useLocation();
  return (
    <nav className={styles.navigation} aria-label="全局导航">
      {navigationItems.map(({ path, label, description }) => (
        <NavLink
          key={path}
          to={path}
          data-route={path.slice(1)}
          onClick={onNavigate}
          viewTransition
          className={() => `${styles.navLink} ${navigationItems.find((entry) => entry.path === path)?.matches.some((match) => location.pathname.startsWith(match)) ? styles.activeNavLink : ''}`}
        >
          <span><strong>{label}</strong><small>{description}</small></span>
        </NavLink>
      ))}
    </nav>
  );
}

function MobileNavigation({ onLogout }: { readonly onLogout: () => void }): JSX.Element {
  return (
    <DialogTrigger>
      <Button className={styles.mobileMenuButton} aria-label="打开全局导航">
        <Menu aria-hidden="true" size={20} />
      </Button>
      <ModalOverlay className={styles.modalOverlay} isDismissable>
        <Modal className={styles.mobileModal}>
          <Dialog className={styles.mobileDialog} aria-label="全局导航">
            {({ close }) => (
              <>
                <div className={styles.mobileDialogHead}>
                  <strong>导航</strong>
                  <Button className={styles.mobileMenuButton} aria-label="关闭全局导航" onPress={close}>
                    <X aria-hidden="true" size={20} />
                  </Button>
                </div>
                <Navigation onNavigate={close} />
                <Button className={styles.logoutButton} onPress={() => { close(); onLogout(); }}>
                  <LogOut aria-hidden="true" size={17} />退出登录
                </Button>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function AppearanceMenu({ appearance }: { readonly appearance: AppearancePreferences & { readonly update: <Key extends keyof AppearancePreferences>(key: Key, value: AppearancePreferences[Key]) => void } }): JSX.Element {
  const choices = <Key extends 'theme' | 'background'>(key: Key, label: string, options: readonly (readonly [AppearancePreferences[Key], string])[]) =>
    <fieldset className={styles.appearanceGroup}><legend>{label}</legend><div>{options.map(([value, text]) => <Button key={value} aria-pressed={appearance[key] === value} onPress={() => appearance.update(key, value)}>{text}</Button>)}</div></fieldset>;
  return <DialogTrigger>
    <Button className={styles.iconButton} aria-label="外观设置">{appearance.theme === 'dark' ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}</Button>
    <Popover className={styles.appearancePopover} placement="bottom end" offset={8}>
      <Dialog className={styles.appearanceDialog} aria-label="外观设置">
        <Heading slot="title">外观</Heading>
        {choices('theme', '主题', [['dark', '深色'], ['light', '浅色']])}
        {choices('background', '背景', [['wallpaper', '场景'], ['ambient', '纯色']])}
      </Dialog>
    </Popover>
  </DialogTrigger>;
}

function preferredAppearance(): AppearancePreferences {
  const fallback: AppearancePreferences = {
    theme: preferredTheme(), background: 'wallpaper',
  };
  try {
    const stored = JSON.parse(window.localStorage.getItem('personal-server-appearance') || '{}') as Partial<AppearancePreferences>;
    return { ...fallback, theme: stored.theme === 'dark' || stored.theme === 'light' ? stored.theme : fallback.theme, background: stored.background === 'ambient' || stored.background === 'wallpaper' ? stored.background : fallback.background };
  } catch { return fallback; }
}

function preferredTheme(): 'dark' | 'light' {
  const stored = window.localStorage.getItem('personal-server-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
