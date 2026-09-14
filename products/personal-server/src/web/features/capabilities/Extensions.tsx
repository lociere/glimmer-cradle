import { useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import { Link } from 'react-router-dom';
import { buildExtensionVersionRows } from './extension-version-support';
import type { ExtensionsController, ExtensionsSnapshot } from './ExtensionsController';
import { ExtensionInstall } from './ExtensionInstall';
import { ExtensionDiagnostics } from './ExtensionDiagnostics';
import { ConfirmationDialog } from '../../shared/ui/ConfirmationDialog/ConfirmationDialog';
import styles from './Extensions.module.css';

export function Extensions({ snapshot, controller }: { snapshot: ExtensionsSnapshot; controller: ExtensionsController }): JSX.Element {
  const [installOpen, setInstallOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const projections = new Map(snapshot.catalog?.projections.map((entry) => [entry.extension_id, entry]));
  const installations = new Map(snapshot.catalog?.installations.map((entry) => [entry.extension_id, entry]));
  const ids = [...new Set([...projections.keys(), ...installations.keys()])].filter((id) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || id.toLocaleLowerCase().includes(needle) || (projections.get(id)?.display_name ?? '').toLocaleLowerCase().includes(needle);
  }).sort();
  const activeId = ids.includes(selectedId) ? selectedId : ids[0];
  useEffect(() => { if (activeId && activeId !== selectedId) setSelectedId(activeId); }, [activeId, selectedId]);
  const disabled = !snapshot.connected || snapshot.busy || snapshot.loading || Boolean(snapshot.readError);
  const projection = activeId ? projections.get(activeId) : undefined;
  const installation = activeId ? installations.get(activeId) : undefined;
  const versions = activeId ? buildExtensionVersionRows(installation && { installedVersions: installation.installed_versions, activeVersion: installation.active_version, updatedAt: installation.updated_at }, projection) : [];
  const running = projection?.lifecycle === 'running' || projection?.lifecycle === 'starting';
  const startVersion = installation?.active_version || installation?.installed_versions[0];
  return <section className={`route-view ${styles.extensions}`} data-role="view-extensions">
    <div className={styles.topline}><nav className={styles.kinds} aria-label="扩展分类"><button aria-current="page">已安装</button><button disabled title="目录 Provider 尚未开放">浏览</button><button disabled title="当前没有待处理更新">更新</button></nav><div className={styles.actions}><button className={styles.button} data-action="extensions-reload" disabled={!snapshot.connected || snapshot.loading} onClick={() => void controller.reload()}>{snapshot.loading ? '正在读取…' : '刷新'}</button><button className={styles.primary} aria-expanded={installOpen} disabled={snapshot.busy || Boolean(snapshot.preview)} onClick={() => setInstallOpen(!installOpen)}>{installOpen ? '收起安装' : '安装扩展'}</button></div></div>
    <label className={styles.search}><span className="visually-hidden">搜索扩展</span><input type="search" value={query} placeholder="搜索扩展" onChange={(event) => setQuery(event.target.value)} /></label>
    {!snapshot.connected && <p role="status">连接已断开。以下为上次读取的扩展状态，恢复连接后自动刷新。</p>}
    {snapshot.error && <p role="alert" className={styles.error}>{snapshot.error}</p>}
    {snapshot.readError && <p role="alert" className={styles.error}>{snapshot.readError}</p>}
    {snapshot.message && <p role="status">{snapshot.message}</p>}
    {installOpen && <ExtensionInstall snapshot={snapshot} controller={controller} />}
    <section className={styles.directory} aria-label="扩展目录" data-role="extension-card-list">
      {!snapshot.initialized && snapshot.loading ? <p role="status">正在读取扩展目录…</p> : snapshot.initialized && ids.length === 0 ? <div className={styles.empty}><h2>尚未安装扩展</h2><p>使用“安装扩展”添加所需能力。</p></div> : null}
      {ids.length > 0 && <div className={styles.browser}>
        <nav className={styles.extensionRail} aria-label="已安装扩展">
          {ids.map((id) => {
            const itemProjection = projections.get(id);
            return <Button key={id} className={styles.railItem} data-role="extension-card" data-extension-id={id} aria-label={`查看 ${id} 详情`} aria-pressed={activeId === id} onPress={() => setSelectedId(id)}>
              <span>{itemProjection?.display_name || id}</span>
            </Button>;
          })}
        </nav>
        {activeId && <article className={styles.detail} data-role="extension-detail" data-extension-id={activeId} aria-label={`${projection?.display_name || activeId} 详情`}>
          <header className={styles.detailHead}><div><small>扩展详情</small><h2>{projection?.display_name || activeId}</h2><p>{activeId}</p></div><span>{projection?.lifecycle || 'installed'}</span></header>
          <p>{projection?.summary || projection?.description || '暂无额外说明。'}</p>
          <dl className={styles.facts}><dt>激活版本</dt><dd>{installation?.active_version || '未激活'}</dd><dt>权限</dt><dd>{projection?.permissions.join(', ') || '无'}</dd><dt>诊断</dt><dd>{projection?.diagnostics.summary || '无'}</dd></dl>
          {projection?.diagnostics.last_error && <p className={styles.error}>{projection.diagnostics.last_error}</p>}
          {!snapshot.connected && <p role="status">连接已断开，暂时无法操作。</p>}
          <div className={styles.actions}><button className={styles.button} data-action="extension-start" disabled={disabled || !startVersion || running} onClick={() => void controller.lifecycle(activeId, 'start', startVersion)}>启用</button><button className={styles.button} data-action="extension-stop" disabled={disabled || !running} onClick={() => void controller.lifecycle(activeId, 'stop', installation?.active_version)}>停用</button><Link className={styles.buttonLink} to={`/system/logs?module=${encodeURIComponent(activeId)}`}>查看日志</Link></div>
          <h3>版本</h3>{versions.map((row) => <div className={styles.version} data-role="extension-version-row" data-version={row.version} key={row.version}><strong>{row.version}</strong><p>{row.stateLabel}</p><div className={styles.actions}><button className={styles.button} data-action="extension-activate-version" disabled={disabled || !row.canActivate} onClick={() => void controller.lifecycle(activeId, 'start', row.version)}>{row.actionLabel}</button><ConfirmationDialog label="卸载此版本" title={`卸载 ${activeId}@${row.version}`} confirmLabel="确认卸载" tone="danger" dataAction="extension-uninstall" disabled={disabled || !row.canUninstall} onConfirm={() => void controller.uninstall(activeId, row.version)}><p>卸载后该版本将从服务器移除；当前激活版本不能卸载。</p></ConfirmationDialog></div></div>)}
          <ExtensionDiagnostics projection={projection} />
        </article>}
      </div>}
    </section>
  </section>;
}
