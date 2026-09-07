import { useState } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { ChevronRight, X } from 'lucide-react';
import { buildExtensionVersionRows } from './extension-version-support';
import type { ExtensionsController, ExtensionsSnapshot } from './ExtensionsController';
import { ExtensionInstall } from './ExtensionInstall';
import styles from './Extensions.module.css';

export function Extensions({ snapshot, controller }: { snapshot: ExtensionsSnapshot; controller: ExtensionsController }): JSX.Element {
  const [installOpen, setInstallOpen] = useState(false);
  const projections = new Map(snapshot.catalog?.projections.map((entry) => [entry.extension_id, entry]));
  const installations = new Map(snapshot.catalog?.installations.map((entry) => [entry.extension_id, entry]));
  const ids = [...new Set([...projections.keys(), ...installations.keys()])].sort();
  const disabled = !snapshot.connected || snapshot.busy || snapshot.loading || Boolean(snapshot.readError);
  return <section className={`route-view ${styles.extensions}`} data-role="view-capabilities">
    <header className={styles.header}><div><h1>扩展</h1><p>查看运行状态，管理安装与版本。</p></div><div className={styles.actions}><button className={styles.button} data-action="extensions-reload" disabled={!snapshot.connected || snapshot.loading} onClick={() => void controller.reload()}>{snapshot.loading ? '正在读取…' : '刷新'}</button><button className={styles.primary} aria-expanded={installOpen} disabled={snapshot.busy || Boolean(snapshot.preview)} onClick={() => setInstallOpen(!installOpen)}>{installOpen ? '收起安装' : '安装扩展'}</button></div></header>
    {!snapshot.connected && <p role="status">连接已断开。以下为上次读取的扩展状态，恢复连接后自动刷新。</p>}
    {snapshot.error && <p role="alert" className={styles.error}>{snapshot.error}</p>}
    {snapshot.readError && <p role="alert" className={styles.error}>{snapshot.readError}</p>}
    {snapshot.message && <p role="status">{snapshot.message}</p>}
    {installOpen && <ExtensionInstall snapshot={snapshot} controller={controller} />}
    <section aria-label="扩展目录" data-role="extension-card-list">
      {!snapshot.initialized && snapshot.loading ? <p role="status">正在读取扩展目录…</p> : snapshot.initialized && ids.length === 0 ? <div className={styles.empty}><h2>尚未安装扩展</h2><p>使用“安装扩展”添加所需能力。</p></div> : null}
      {ids.map((id) => {
        const projection = projections.get(id);
        const installation = installations.get(id);
        const versions = buildExtensionVersionRows(installation && { installedVersions: installation.installed_versions, activeVersion: installation.active_version, updatedAt: installation.updated_at }, projection);
        const running = projection?.lifecycle === 'running' || projection?.lifecycle === 'starting';
        const startVersion = installation?.active_version || installation?.installed_versions[0];
        return <article className={styles.entry} data-role="extension-card" data-extension-id={id} key={id}>
          <DialogTrigger>
            <Button className={styles.row} aria-label={`查看 ${id} 详情`}><span><strong>{projection?.display_name || id}</strong><small>{id}</small><small>激活版本：{installation?.active_version || '未激活'}</small><small>已安装：{installation?.installed_versions.join(', ') || '无'}</small></span><span>{projection?.lifecycle || 'installed'}</span><ChevronRight aria-hidden="true" size={16} /></Button>
            <ModalOverlay className={styles.scrim} isDismissable><Modal className={styles.drawer}><Dialog className={styles.dialog}>{({ close }) => <>
              <div className={styles.header}><Heading slot="title">{projection?.display_name || id}</Heading><Button className={styles.button} aria-label="关闭扩展详情" onPress={close} autoFocus><X aria-hidden="true" size={18} /></Button></div>
              <p>{id}</p><p>{projection?.summary || projection?.description || '暂无额外说明。'}</p><p>状态：{projection?.lifecycle || 'installed'}</p><p>权限：{projection?.permissions.join(', ') || '无'}</p><p>诊断：{projection?.diagnostics.summary || '无'}</p>
              {projection?.diagnostics.last_error && <p className={styles.error}>{projection.diagnostics.last_error}</p>}
              {!snapshot.connected && <p role="status">连接已断开，暂时无法操作。</p>}
              {snapshot.error && <p role="alert" className={styles.error}>{snapshot.error}</p>}
              {snapshot.readError && <p role="alert" className={styles.error}>{snapshot.readError}</p>}
              <div className={styles.actions}><button className={styles.button} data-action="extension-start" disabled={disabled || !startVersion || running} onClick={() => void controller.lifecycle(id, 'start', startVersion)}>启用</button><button className={styles.button} data-action="extension-stop" disabled={disabled || !running} onClick={() => void controller.lifecycle(id, 'stop', installation?.active_version)}>停用</button></div>
              <h3>版本</h3>{versions.map((row) => <div className={styles.version} data-role="extension-version-row" data-version={row.version} key={row.version}><strong>{row.version}</strong><p>{row.stateLabel}</p><div className={styles.actions}><button className={styles.button} data-action="extension-activate-version" disabled={disabled || !row.canActivate} onClick={() => void controller.lifecycle(id, 'start', row.version)}>{row.actionLabel}</button><button className={styles.danger} data-action="extension-uninstall" disabled={disabled || !row.canUninstall} onClick={() => { if (window.confirm(`确认卸载 ${id}@${row.version}？`)) void controller.uninstall(id, row.version); }}>卸载此版本</button></div></div>)}
            </>}</Dialog></Modal></ModalOverlay>
          </DialogTrigger>
        </article>;
      })}
    </section>
  </section>;
}
