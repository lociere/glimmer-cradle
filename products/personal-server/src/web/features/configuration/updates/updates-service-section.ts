import type { ConfigurationSnapshot } from '@glimmer-cradle/protocol';
import type {
  DeploymentOperationResult,
  DeploymentOperationsSnapshot,
} from '../../../shared/api/personal-server-client';

export function renderUpdatesServiceSection(
  snapshot: ConfigurationSnapshot,
  operations: DeploymentOperationsSnapshot | null,
  lastResult: DeploymentOperationResult | null,
  pending: boolean,
  loadError: string | null,
): string {
  const service = operations?.service;
  const update = operations?.update;
  return `
    <section class="settings-section settings-card-shell" data-role="updates-service-section">
      <div class="settings-section-head">
        <div><span>更新与服务控制</span><h2>当前 apply / restart 能力</h2></div>
      </div>
      <div class="settings-card">
        <strong>${snapshot.service.cognition_ready ? 'Cognition 已就绪' : 'Cognition 未就绪'}</strong>
        <p>${snapshot.service.restart_supported ? '保存 Provider 后由 Kernel owner 触发 reload/restart，并明确回传 apply 状态。' : '当前部署不支持受控重启。'}</p>
      </div>
      <div class="settings-card">
        <strong>部署级运维</strong>
        <p>${escape(loadError || update?.disabled_reason || service?.disabled_reason || '正在读取部署级能力。')}</p>
        <p>当前版本 ${escape(update?.current_version || 'unknown')}${update?.available_version ? `，候选版本 ${escape(update.available_version)}` : ''}。</p>
        <div class="inline-actions">
          <button class="quiet-button" type="button" data-action="check-updates" ${update?.check_supported && !pending ? '' : 'disabled'}>检查更新</button>
          <button class="quiet-button" type="button" data-action="apply-updates" ${update?.apply_supported && !pending ? '' : 'disabled'}>应用更新</button>
          <button class="quiet-button" type="button" data-action="restart-service" ${service?.restart_supported && !pending ? '' : 'disabled'}>重启服务</button>
          <button class="quiet-button danger" type="button" data-action="stop-service" ${service?.stop_supported && !pending ? '' : 'disabled'}>停止服务</button>
        </div>
        ${lastResult?.message ? `<p>${escape(lastResult.message)}</p>` : ''}
      </div>
    </section>
  `;
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
