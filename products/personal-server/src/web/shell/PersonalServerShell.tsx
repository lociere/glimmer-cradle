import { useEffect, useState } from 'react';
import {
  Activity,
  Blocks,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Settings,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button, Dialog, DialogTrigger, Modal, ModalOverlay } from 'react-aria-components';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type {
  PersonalServerAppController,
  PersonalServerAppSnapshot,
} from '../app/PersonalServerAppController';
import { HealthBadge } from '../shared/ui/HealthBadge/HealthBadge';
import styles from './PersonalServerShell.module.css';

interface NavigationItem {
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const navigationItems: readonly NavigationItem[] = [
  { path: '/conversation', label: '对话', description: '继续当前交流', icon: MessageCircle },
  { path: '/overview', label: '概览', description: '判断系统是否健康', icon: Activity },
  { path: '/capabilities', label: '能力', description: '管理扩展与能力', icon: Blocks },
  { path: '/activity', label: '活动', description: '追踪事件与问题', icon: Activity },
  { path: '/settings', label: '设置', description: '调整受控配置', icon: Settings },
];

export function PersonalServerShell(props: {
  readonly controller: PersonalServerAppController;
  readonly snapshot: PersonalServerAppSnapshot;
}): JSX.Element {
  const location = useLocation();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => preferredTheme());
  const current = navigationItems.find((item) => location.pathname === item.path);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('personal-server-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.title = `${current?.label ?? '未知路由'} · 微光摇篮 Personal Server`;
  }, [current]);

  const connectionLabel = {
    online: '在线',
    connecting: '正在连接',
    waiting: '等待服务',
  }[props.snapshot.connection];

  return (
    <div className={styles.shell} data-role="app-shell">
      <aside className={styles.sidebar} aria-label="产品与主导航">
        <div className={styles.identity}>
          <span className={styles.wordmark}>微光摇篮</span>
          <span>Personal Server</span>
        </div>
        <Navigation />
        <div className={styles.sidebarFooter}>
          <HealthBadge
            label={connectionLabel}
            tone={props.snapshot.connection === 'online' ? 'ready' : props.snapshot.connection === 'connecting' ? 'connecting' : 'degraded'}
            dataRole="connection-label"
          />
          <button className={styles.logoutButton} type="button" onClick={() => void props.controller.logout()}>
            <LogOut aria-hidden="true" size={17} />
            退出登录
          </button>
        </div>
      </aside>

      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.mobileIdentity}>
            <MobileNavigation onLogout={() => void props.controller.logout()} />
            <div>
              <span>{current?.label ?? '未知路由'}</span>
              <strong>{props.snapshot.productName}</strong>
            </div>
          </div>
          <div className={styles.location}>
            <span>{current?.label ?? '未知路由'}</span>
            <strong>{current?.description ?? '返回已知一级域继续工作'}</strong>
          </div>
          <div className={styles.globalActions}>
            <HealthBadge
              label={connectionLabel}
              tone={props.snapshot.connection === 'online' ? 'ready' : props.snapshot.connection === 'connecting' ? 'connecting' : 'degraded'}
              dataRole="connection-label"
            />
            <button
              className={styles.iconButton}
              type="button"
              aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
            </button>
          </div>
        </header>
        <main className={styles.workspace} id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { readonly onNavigate?: () => void }): JSX.Element {
  return (
    <nav className={styles.navigation} aria-label="全局导航">
      {navigationItems.map(({ path, label, description, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          data-route={path.slice(1)}
          onClick={onNavigate}
          className={({ isActive }) => `${styles.navLink} ${isActive ? styles.activeNavLink : ''}`}
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
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
                  <div><strong>微光摇篮</strong><span>Personal Server</span></div>
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

function preferredTheme(): 'dark' | 'light' {
  const stored = window.localStorage.getItem('personal-server-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
