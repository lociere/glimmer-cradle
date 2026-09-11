import { useState } from 'react';
import type { ExtensionInstallPrepareRequest } from '../../../shared/control-center-models';
import type { ExtensionsController, ExtensionsSnapshot } from './ExtensionsController';
import { createRequestId } from '../../shared/request-id';
import styles from './Extensions.module.css';

export function ExtensionInstall({ snapshot, controller }: { snapshot: ExtensionsSnapshot; controller: ExtensionsController }): JSX.Element {
  const [source, setSource] = useState('repository');
  const [fields, setFields] = useState({ repository: '', tag: '', catalog: '', id: '', channel: 'stable', manifest: '' });
  const [validation, setValidation] = useState('');
  const locked = snapshot.busy || Boolean(snapshot.preview);
  const input = (field: keyof typeof fields, label: string, dataField: string, placeholder = '') => <label className={styles.field}>{label}<input data-field={dataField} value={fields[field]} placeholder={placeholder} disabled={locked} onChange={(event) => setFields({ ...fields, [field]: event.target.value })} /></label>;
  const prepare = () => {
    let request: ExtensionInstallPrepareRequest['source'] | null = null;
    if (source === 'repository' && fields.repository.trim() && fields.tag.trim()) request = { kind: 'repository', repository: fields.repository.trim(), tag: fields.tag.trim() };
    if (source === 'registry' && fields.catalog.trim() && fields.id.trim()) request = { kind: 'registry', catalog_url: fields.catalog.trim(), extension_id: fields.id.trim(), channel: fields.channel as 'stable' | 'beta' | 'nightly' };
    if (source === 'release_manifest' && fields.manifest.trim()) request = { kind: 'release_manifest', url: fields.manifest.trim() };
    if (source === 'file' && snapshot.upload) request = { kind: 'uploaded_package', upload_id: snapshot.upload.upload_id };
    if (!request) { setValidation('请补全安装来源后生成预览。'); return; }
    setValidation(''); void controller.prepare({ request_id: createRequestId('extension-install'), source: request });
  };
  const preview = snapshot.preview;
  return <section className={styles.install} aria-label="安装扩展" data-role="extension-install-section">
    <h2>安装扩展</h2><p>选择来源，核对预览后安装。</p>
    <div className={styles.form} data-role="extension-install-form">
      <label className={styles.field}>来源类型<select data-field="source-kind" disabled={locked} value={source} onChange={(event) => { setSource(event.target.value); setValidation(''); }}>
        <option value="repository">仓库 Release</option><option value="file">本地 .gcex</option><option value="registry">Registry 条目</option><option value="release_manifest">Release Manifest</option>
      </select></label>
      {source === 'repository' && <>{input('repository', '仓库', 'repository', 'publisher/repo')}{input('tag', 'Tag', 'tag', 'v1.2.3')}</>}
      {source === 'registry' && <>{input('catalog', 'Catalog URL', 'catalog-url')}{input('id', 'Extension ID', 'extension-id')}<label className={styles.field}>Channel<select data-field="channel" disabled={locked} value={fields.channel} onChange={(event) => setFields({ ...fields, channel: event.target.value })}><option>stable</option><option>beta</option><option>nightly</option></select></label></>}
      {source === 'release_manifest' && input('manifest', 'Manifest URL', 'manifest-url')}
      {source === 'file' && <><label className={styles.field}>本地扩展包<input type="file" data-field="local-package" accept=".gcex,application/octet-stream" disabled={locked || !snapshot.connected} onChange={(event) => { const file = event.target.files?.[0]; if (file) void controller.upload(file); }} /></label><p data-role="local-package-upload">{snapshot.upload ? `${snapshot.upload.file_name} · ${snapshot.upload.size} bytes` : '请选择 .gcex 文件。上传后仅在当前会话内暂存。'}</p></>}
      <button className={styles.primary} data-action="extensions-prepare" disabled={!snapshot.connected || locked} onClick={prepare}>生成安装预览</button>
    </div>
    {validation && <p role="alert">{validation}</p>}
    {preview && <section className={styles.preview} data-role="extension-preview" aria-label="安装预览">
      <h3>{preview.extension?.name || '扩展安装预览'}</h3><p>{preview.message || preview.extension?.description}</p>
      {preview.extension && <><p>{preview.extension.id} · {preview.extension.version} · {preview.extension.publisher}</p><p>适用平台：{preview.extension.platforms.join(', ') || '未声明'}</p><p>权限：{preview.extension.permissions.join(', ') || '无'}</p></>}
      {preview.artifact && <p>SHA256 {preview.artifact.sha256} · {preview.artifact.size} bytes · {preview.artifact.platform}</p>}
      {preview.trust && <ul><li>来源：{preview.trust.source_kind}</li><li>目录审核：{preview.trust.listing_reviewed ? '已审阅' : '未审阅'}</li><li>发布者验证：{preview.trust.publisher_verified ? '已验证' : '未验证'}</li><li>签名：{preview.trust.artifact_signed ? '已签名' : '未签名'}</li><li>构建证明：{preview.trust.build_attested ? '已附带' : '未附带'}</li></ul>}
      <div className={styles.actions}><button className={styles.primary} data-action="extensions-commit" disabled={!snapshot.connected || snapshot.busy || preview.status !== 'ready' || !preview.transaction_id} onClick={() => void controller.commit()}>确认安装</button><button className={styles.button} data-action="extensions-cancel" disabled={!snapshot.connected || snapshot.busy} onClick={() => void controller.cancel()}>取消预览</button></div>
    </section>}
  </section>;
}
