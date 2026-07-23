import type { ConfigurationSnapshot } from '@glimmer-cradle/protocol';
import type {
  DeploymentOperationResult,
  DeploymentOperationsSnapshot,
} from '../../../shared/api/personal-server-client';
import { escapeHtml } from '../configuration-support';

export function renderStorageBackupSection(
  snapshot: ConfigurationSnapshot,
  operations: DeploymentOperationsSnapshot | null,
  lastResult: DeploymentOperationResult | null,
  pending: boolean,
  loadError: string | null,
): string {
  const backup = operations?.backup;
  const entries = backup?.entries.length
    ? backup.entries.map((entry) => `
      <div class="backup-row">
        <div><strong>${escapeHtml(entry.backup_id)}</strong><p>${escapeHtml(entry.status)}</p></div>
        <button class="quiet-button" type="button" data-action="restore-backup" data-backup-id="${escapeHtml(entry.backup_id)}" ${backup.supported && !pending ? '' : 'disabled'}>恢复</button>
      </div>
    `).join('')
    : '<p>当前还没有可见备份记录。</p>';
  return `
    <section class="settings-section settings-card-shell" data-role="storage-backup-section">
      <div class="settings-section-head">
        <div><span>存储与备份</span><h2>当前受管路径</h2></div>
      </div>
      <div class="settings-card">
        <strong>配置 / 数据 / 状态</strong>
        <p>${escapeHtml(snapshot.storage.config_root)}</p>
        <p>${escapeHtml(snapshot.storage.data_root)}</p>
        <p>${escapeHtml(snapshot.storage.state_root)}</p>
      </div>
      <div class="settings-card">
        <strong>${loadError ? '备份事务状态读取失败' : backup?.supported ? '备份事务可用' : '备份事务当前不可用'}</strong>
        <p>${escapeHtml(loadError || (backup?.supported
          ? `备份目录：${backup.backup_root || '未声明'}`
          : backup?.disabled_reason || '正在读取运维能力。'))}</p>
        <div class="inline-actions">
          <button class="primary-button" type="button" data-action="create-backup" ${backup?.supported && !pending ? '' : 'disabled'}>创建备份</button>
        </div>
        ${lastResult?.message ? `<p>${escapeHtml(lastResult.message)}</p>` : ''}
      </div>
      <div class="settings-card">
        <strong>最近备份</strong>
        <div class="settings-backup-list">${entries}</div>
      </div>
    </section>
  `;
}
