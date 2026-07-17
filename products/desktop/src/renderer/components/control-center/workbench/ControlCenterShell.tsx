import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { PAGE_ITEMS, STATUS_LABELS, clamp, type ControlCenterPage, type PageItem } from '../model';
import { StatusBadge } from '../shared/ui';
import { PAGE_ICONS, PAGE_SECTIONS } from './navigation';
import type { WorkbenchPreferences } from './useWorkbenchPreferences';

const NAV_MIN = 184;
const NAV_MAX = 300;
const NAV_DEFAULT = 216;
const NAV_OVERLAY_WIDTH = 900;
const INSPECTOR_MIN = 236;
const INSPECTOR_MAX = 340;
const INSPECTOR_MAX_SHELL_RATIO = 0.28;
const PRIMARY_RAIL_WIDTH = 52;
const WORKSPACE_INLINE_MIN = 540;
const PANE_CHROME_ALLOWANCE = 60;

interface ControlCenterShellProps {
  activePage: ControlCenterPage;
  activeSection: string;
  currentPage: PageItem;
  systemStatus: string;
  avatarLabel: string;
  characterName: string;
  preferences: WorkbenchPreferences;
  onPreferencesChange: (patch: Partial<WorkbenchPreferences>) => void;
  onNavigate: (page: ControlCenterPage) => void;
  onSectionChange: (section: string) => void;
  children: React.ReactNode;
}

export const ControlCenterShell: React.FC<ControlCenterShellProps> = ({
  activePage,
  activeSection,
  currentPage,
  systemStatus,
  avatarLabel,
  characterName,
  preferences,
  onPreferencesChange,
  onNavigate,
  onSectionChange,
  children,
}) => {
  const [navWidth, setNavWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('glimmer-cradle.workbench.sidebar-width'));
    return Number.isFinite(stored) ? clamp(stored, NAV_MIN, NAV_MAX) : NAV_DEFAULT;
  });
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [shellWidth, setShellWidth] = useState(() => window.innerWidth);
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(() => {
    const raw = window.localStorage.getItem('glimmer-cradle.workbench.inspector-width');
    if (raw === null) return null;
    const stored = Number(raw);
    return Number.isFinite(stored) ? clamp(stored, INSPECTOR_MIN, INSPECTOR_MAX) : null;
  });
  const [inspectorMeasuredWidth, setInspectorMeasuredWidth] = useState(280);
  const [narrowNavOpen, setNarrowNavOpen] = useState(false);
  const [inspectorOverlayOpen, setInspectorOverlayOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isInspectorResizing, setIsInspectorResizing] = useState(false);
  const resizeStart = useRef({ x: 0, width: NAV_DEFAULT });
  const inspectorResizeStart = useRef({ x: 0, width: 280 });
  const shellRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null);
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const sections = PAGE_SECTIONS[activePage];
  const currentSection = sections.find((item) => item.id === activeSection) ?? sections[0];
  const primaryPages = PAGE_ITEMS.filter((item) => item.id !== 'logs' && item.id !== 'settings');
  const utilityPages = PAGE_ITEMS.filter((item) => item.id === 'logs' || item.id === 'settings');
  const narrowLayout = shellWidth < NAV_OVERLAY_WIDTH;
  const inlineSectionNavWidth = narrowLayout || navCollapsed ? 0 : navWidth;
  const preferredInspectorWidth = inspectorWidth ?? clamp(shellWidth * 0.18, INSPECTOR_MIN, INSPECTOR_MAX);
  const maxInlineInspectorWidth = clamp(
    Math.min(
      shellWidth - PRIMARY_RAIL_WIDTH - inlineSectionNavWidth - WORKSPACE_INLINE_MIN - PANE_CHROME_ALLOWANCE,
      Math.floor(shellWidth * INSPECTOR_MAX_SHELL_RATIO),
    ),
    INSPECTOR_MIN,
    INSPECTOR_MAX,
  );
  const inlineInspectorLayout = shellWidth >= (
    PRIMARY_RAIL_WIDTH
      + inlineSectionNavWidth
      + preferredInspectorWidth
      + WORKSPACE_INLINE_MIN
      + PANE_CHROME_ALLOWANCE
  );
  const sectionNavHidden = narrowLayout ? !narrowNavOpen : navCollapsed;
  const inspectorExpanded = inlineInspectorLayout ? !preferences.inspectorCollapsed : inspectorOverlayOpen;

  useEffect(() => {
    if (!sections.some((item) => item.id === activeSection)) onSectionChange(sections[0]?.id ?? 'main');
  }, [activeSection, onSectionChange, sections]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setShellWidth(entry.contentRect.width);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const inspector = inspectorRef.current;
    if (!inspector) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setInspectorMeasuredWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(inspector);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!narrowLayout) setNarrowNavOpen(false);
  }, [narrowLayout]);

  useEffect(() => {
    if (inlineInspectorLayout) setInspectorOverlayOpen(false);
  }, [inlineInspectorLayout]);

  useEffect(() => {
    window.localStorage.setItem('glimmer-cradle.workbench.sidebar-width', String(Math.round(navWidth)));
  }, [navWidth]);

  useEffect(() => {
    if (inspectorWidth === null) window.localStorage.removeItem('glimmer-cradle.workbench.inspector-width');
    else window.localStorage.setItem('glimmer-cradle.workbench.inspector-width', String(Math.round(inspectorWidth)));
  }, [inspectorWidth]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const move = (event: PointerEvent): void => {
      setNavWidth(clamp(resizeStart.current.width + event.clientX - resizeStart.current.x, NAV_MIN, NAV_MAX));
    };
    const stop = (): void => setIsResizing(false);
    document.body.classList.add('nav-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      document.body.classList.remove('nav-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isInspectorResizing) return undefined;
    const move = (event: PointerEvent): void => {
      setInspectorWidth(clamp(
        inspectorResizeStart.current.width + inspectorResizeStart.current.x - event.clientX,
        INSPECTOR_MIN,
        maxInlineInspectorWidth,
      ));
    };
    const stop = (): void => setIsInspectorResizing(false);
    document.body.classList.add('inspector-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      document.body.classList.remove('inspector-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [isInspectorResizing, maxInlineInspectorWidth]);

  useEffect(() => {
    if (!narrowNavOpen && !inspectorOverlayOpen) return undefined;
    const closeOverlay = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const restoreInspectorFocus = inspectorOverlayOpen;
      setNarrowNavOpen(false);
      setInspectorOverlayOpen(false);
      if (restoreInspectorFocus) window.requestAnimationFrame(() => inspectorTriggerRef.current?.focus());
    };
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, [inspectorOverlayOpen, narrowNavOpen]);

  useEffect(() => {
    if (inlineInspectorLayout || !inspectorOverlayOpen) return undefined;
    const frame = window.requestAnimationFrame(() => inspectorCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [inlineInspectorLayout, inspectorOverlayOpen]);

  const toggleTheme = (): void => {
    const visibleTheme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
    onPreferencesChange({ theme: visibleTheme === 'dark' ? 'light' : 'dark' });
  };

  const toggleInspector = (): void => {
    if (inlineInspectorLayout) {
      onPreferencesChange({ inspectorCollapsed: !preferences.inspectorCollapsed });
      return;
    }
    setNarrowNavOpen(false);
    setInspectorOverlayOpen((open) => !open);
  };

  const closeInspector = (): void => {
    if (inlineInspectorLayout) onPreferencesChange({ inspectorCollapsed: true });
    else setInspectorOverlayOpen(false);
    window.requestAnimationFrame(() => inspectorTriggerRef.current?.focus());
  };

  return (
    <main className="control-center-root">
      <header className="window-frame-bar">
        <div className="frame-leading" aria-hidden>
          <span className="frame-app-glyph"><Moon size={16} /></span>
        </div>
        <div className="window-drag-region" aria-label="窗口拖动区域">
          <div className="frame-document-tab">
            <span>{currentPage.label}</span>
            <strong>{currentSection?.label}</strong>
          </div>
        </div>
        <div className="frame-actions">
          <button
            type="button"
            className="icon-button tooltip-control"
            aria-label="切换主题"
            data-tooltip={preferences.theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
            onClick={toggleTheme}
          >
            {document.body.dataset.theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <span className={`connection-dot connection-${systemStatus}`} aria-hidden />
          <span className="connection-label">{STATUS_LABELS[systemStatus] ?? systemStatus}</span>
        </div>
        <div className="window-controls" aria-label="窗口控制">
          <button type="button" aria-label="最小化" data-tooltip="最小化" onClick={() => { void window.desktopHost.minimizeWindow(); }}><Minus size={14} /></button>
          <button type="button" aria-label="最大化或还原" data-tooltip="最大化或还原" onClick={() => { void window.desktopHost.toggleMaximizeWindow(); }}><Square size={12} /></button>
          <button type="button" className="window-control-close" aria-label="关闭" data-tooltip="关闭" onClick={() => { void window.desktopHost.closeWindow(); }}><X size={14} /></button>
        </div>
      </header>

      <div
        ref={shellRef}
        className={`control-center-shell ${sectionNavHidden ? 'section-nav-collapsed' : ''} ${narrowLayout ? 'layout-narrow' : ''} ${inlineInspectorLayout ? 'layout-inspector-inline' : ''} ${narrowNavOpen ? 'narrow-nav-open' : ''} ${preferences.inspectorCollapsed ? 'inspector-collapsed' : ''} ${inspectorOverlayOpen ? 'inspector-overlay-open' : ''}`}
        style={{
          '--section-nav-width': `${navWidth}px`,
          '--inspector-width': inspectorWidth === null ? 'clamp(236px, 18vw, 320px)' : `${inspectorWidth}px`,
        } as React.CSSProperties}
      >
        <nav className="primary-navigation" aria-label="主导航">
          <div className="primary-navigation-items">
            {primaryPages.map((item) => <RailButton key={item.id} item={item} active={activePage === item.id} onClick={() => onNavigate(item.id)} />)}
          </div>
          <div className="primary-navigation-utility-items">
            {utilityPages.map((item) => <RailButton key={item.id} item={item} active={activePage === item.id} onClick={() => onNavigate(item.id)} />)}
          </div>
        </nav>

        {narrowLayout && narrowNavOpen && (
          <button type="button" className="section-navigation-scrim" aria-label="关闭分区导航" onClick={() => setNarrowNavOpen(false)} />
        )}

        <aside className="section-navigation" aria-label="页面分区">
          <div className="section-navigation-head">
            <div><span>{currentPage.eyebrow}</span><strong>{currentPage.label}</strong></div>
            <button type="button" className="icon-button tooltip-control" aria-label="收起分区导航" data-tooltip="收起侧栏" onClick={() => {
              if (narrowLayout) setNarrowNavOpen(false);
              else setNavCollapsed(true);
            }}><PanelLeftClose size={16} /></button>
          </div>
          <nav className="section-navigation-list" aria-label="页面分区">
            {sections.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeSection;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-current={active ? 'location' : undefined}
                  className={`section-navigation-item ${active ? 'section-navigation-item-active' : ''}`}
                  onClick={() => {
                    onSectionChange(item.id);
                    if (narrowLayout) setNarrowNavOpen(false);
                  }}
                >
                  <Icon size={16} /><span>{item.label}</span>{active && <ChevronRight size={14} className="section-navigation-chevron" />}
                </button>
              );
            })}
          </nav>
          <div className="section-navigation-status">
            <span className={`connection-dot connection-${systemStatus}`} />
            <div><strong>{STATUS_LABELS[systemStatus] ?? systemStatus}</strong><span>{avatarLabel}</span></div>
          </div>
        </aside>

        <div
          className="section-navigation-resizer"
          role="separator"
          aria-label="调整分区导航宽度"
          aria-orientation="vertical"
          aria-valuemin={NAV_MIN}
          aria-valuemax={NAV_MAX}
          aria-valuenow={navWidth}
          tabIndex={navCollapsed || narrowLayout ? -1 : 0}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === 'ArrowLeft') setNavWidth((width) => clamp(width - step, NAV_MIN, NAV_MAX));
            else if (event.key === 'ArrowRight') setNavWidth((width) => clamp(width + step, NAV_MIN, NAV_MAX));
            else if (event.key === 'Home') setNavWidth(NAV_MIN);
            else if (event.key === 'End') setNavWidth(NAV_MAX);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            if (navCollapsed || narrowLayout) return;
            resizeStart.current = { x: event.clientX, width: navWidth };
            setIsResizing(true);
          }}
        />

        <section className="control-workspace">
          {systemStatus !== 'online' && <div className={`status-banner banner-${systemStatus}`} role="status" aria-live="polite">核心服务当前{STATUS_LABELS[systemStatus] ?? systemStatus}，部分操作暂不可用。</div>}
          <div className="workspace-page-bar">
            <div className="workspace-page-leading">
              {sectionNavHidden && (
                <button type="button" className="workspace-nav-trigger tooltip-control" aria-label="展开分区导航" data-tooltip="展开侧栏" onClick={() => {
                  if (narrowLayout) setNarrowNavOpen(true);
                  else setNavCollapsed(false);
                }}>
                  <PanelLeftOpen size={16} />
                </button>
              )}
              <div className="workspace-breadcrumb"><span>{currentPage.label}</span><i>/</i><strong>{currentSection?.label}</strong></div>
            </div>
            <div className="workspace-page-meta">
              <StatusBadge tone={systemStatus === 'online' ? 'ready' : 'warn'}>{STATUS_LABELS[systemStatus] ?? systemStatus}</StatusBadge>
              <button
                ref={inspectorTriggerRef}
                type="button"
                className="workspace-context-trigger tooltip-control"
                aria-label={`${inspectorExpanded ? (inlineInspectorLayout ? '收起' : '关闭') : (inlineInspectorLayout ? '展开' : '打开')}右侧上下文栏`}
                aria-controls="workbench-context-inspector"
                aria-expanded={inspectorExpanded}
                data-tooltip={`${inspectorExpanded ? (inlineInspectorLayout ? '收起' : '关闭') : (inlineInspectorLayout ? '展开' : '打开')}上下文栏`}
                onClick={toggleInspector}
              >
                {inspectorExpanded ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            </div>
          </div>
          <div className="workspace-scroll">
            <div className="workspace-content page-surface-transition" key={`${activePage}:${activeSection}`}>
              {children}
            </div>
          </div>
        </section>

        <div
          className="inspector-resizer"
          role="separator"
          aria-label="调整右侧上下文栏宽度"
          aria-orientation="vertical"
          aria-valuemin={INSPECTOR_MIN}
          aria-valuemax={maxInlineInspectorWidth}
          aria-valuenow={inspectorMeasuredWidth}
          aria-valuetext={inspectorWidth === null ? `自动宽度，当前 ${inspectorMeasuredWidth} 像素` : `${inspectorMeasuredWidth} 像素`}
          tabIndex={inlineInspectorLayout && !preferences.inspectorCollapsed ? 0 : -1}
          onDoubleClick={() => setInspectorWidth(null)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === 'ArrowLeft') setInspectorWidth(clamp(inspectorMeasuredWidth + step, INSPECTOR_MIN, maxInlineInspectorWidth));
            else if (event.key === 'ArrowRight') setInspectorWidth(clamp(inspectorMeasuredWidth - step, INSPECTOR_MIN, maxInlineInspectorWidth));
            else if (event.key === 'Home') setInspectorWidth(INSPECTOR_MIN);
            else if (event.key === 'End') setInspectorWidth(maxInlineInspectorWidth);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            if (!inlineInspectorLayout || preferences.inspectorCollapsed) return;
            inspectorResizeStart.current = { x: event.clientX, width: inspectorMeasuredWidth };
            setIsInspectorResizing(true);
          }}
        />

        {inspectorOverlayOpen && !inlineInspectorLayout && (
          <button type="button" className="inspector-overlay-scrim" aria-label="关闭右侧上下文栏" onClick={closeInspector} />
        )}
        <aside ref={inspectorRef} id="workbench-context-inspector" className="workbench-inspector" aria-label="上下文栏">
          <div className="inspector-head">
            <div className="inspector-head-copy"><span>{currentPage.label}</span><strong>当前上下文</strong></div>
            <button
              ref={inspectorCloseRef}
              type="button"
              className="icon-button tooltip-control inspector-close"
              aria-label={inlineInspectorLayout ? '关闭当前上下文栏' : '关闭右侧上下文栏'}
              data-tooltip={inlineInspectorLayout ? '收起上下文栏' : '关闭上下文栏'}
              onClick={closeInspector}
            >
              <PanelRightClose size={16} />
            </button>
          </div>
          <section className="inspector-section">
            <span>连接</span>
            <div className="inspector-status"><i className={`connection-dot connection-${systemStatus}`} /><strong>{STATUS_LABELS[systemStatus] ?? systemStatus}</strong></div>
          </section>
          <section className="inspector-section">
            <span>角色</span>
            <strong>{characterName}</strong>
            <em>{avatarLabel}</em>
          </section>
          {activePage === 'chat' && <section className="inspector-section inspector-actions">
            <span>对话关联</span>
            <button type="button" onClick={() => onNavigate('memory')}>查看记忆</button>
            <button type="button" onClick={() => onNavigate('character')}>角色状态</button>
          </section>}
          {activePage === 'logs' && <section className="inspector-section">
            <span>查看方式</span><strong>按交互链路</strong><em>从最近活动进入模型、技能和服务记录</em>
          </section>}
          <div className="inspector-footer"><span>本机</span><em>工作台</em></div>
        </aside>
      </div>
    </main>
  );
};

const RailButton: React.FC<{ item: PageItem; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => {
  const Icon = PAGE_ICONS[item.id];
  return (
    <button
      type="button"
      className={`primary-navigation-item tooltip-control ${active ? 'primary-navigation-item-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      data-tooltip={item.label}
      onClick={onClick}
    >
      <Icon size={19} />
    </button>
  );
};
