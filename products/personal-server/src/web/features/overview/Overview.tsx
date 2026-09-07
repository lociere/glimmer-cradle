import { Link } from 'react-router-dom';
import type { PersonalServerAppSnapshot } from '../../app/PersonalServerAppController';
import { RuntimeDetails } from './RuntimeDetails';
import styles from './Overview.module.css';

export interface OverviewProps {
  readonly snapshot: Pick<PersonalServerAppSnapshot, 'status' | 'statusError' | 'connection' | 'runtimes' | 'runtimeCatalogUpdatedAt' | 'runtimeCatalogCurrent' | 'configuration'>;
  readonly configurationRead: { readonly state: 'loading' | 'success' } | { readonly state: 'error'; readonly message: string };
  readonly onRetryConfiguration: () => void;
}

export function Overview({ snapshot, configurationRead, onRetryConfiguration }: OverviewProps): JSX.Element {
  const { status, statusError, connection, runtimes, runtimeCatalogUpdatedAt, configuration } = snapshot;
  const route = configuration?.llm.default_route;
  const unavailable = runtimes.filter((runtime) => runtime.state === 'failed' || runtime.state === 'degraded');
  const readyCount = runtimes.filter((runtime) => runtime.state === 'ready').length;
  const stale = connection !== 'online';
  const catalogStale = stale || !snapshot.runtimeCatalogCurrent;
  const headline = statusError ? '暂时无法确认服务状态'
    : !status ? '正在读取服务状态'
      : status.ready ? '服务已就绪'
        : status.status === 'failed' ? '服务尚不可用' : '服务正在启动';
  const tone = statusError || status?.status === 'failed' ? 'danger' : status?.ready ? 'ready' : 'waiting';

  return (
    <section className={`route-view ${styles.overview}`} data-role="view-overview">
      <header className={styles.summary}>
        <div className={styles.summaryText}>
          <span className={styles.eyebrow}>系统概览</span>
          <h1>{headline}</h1>
          <p className={styles[tone]} role={statusError ? 'alert' : 'status'}>
            {statusError || status?.summary || '等待服务提供就绪状态。'}
          </p>
          {status?.observed_at != null && <p className={styles.observed}>最近观测 <time>{formatTime(status.observed_at)}</time>{statusError && '（上次成功观测）'}</p>}
        </div>
        <Link className={styles.action} to="/activity">查看诊断活动</Link>
      </header>

      {stale && <div className={styles.notice} role="status">
        <strong>{connection === 'connecting' ? '正在连接实时控制面' : '实时控制面未连接'}</strong>
        <p>{runtimeCatalogUpdatedAt === null ? '连接后将读取运行体目录和模型配置。' : '下方保留上次收到的投影，连接恢复后自动更新。'}</p>
      </div>}
      {!stale && catalogStale && runtimeCatalogUpdatedAt !== null && <p role="status" className={styles.notice}>实时连接已恢复，正在等待新目录；运行体仍显示上次投影。</p>}
      {status?.connection_error && <p className={styles.danger} role="alert">{status.connection_error}</p>}

      <section className={styles.section} aria-labelledby="overview-runtimes">
        <div className={styles.sectionHead}>
          <div><h2 id="overview-runtimes">运行体</h2><p>{runtimeCatalogUpdatedAt === null ? '等待目录投影' : `${readyCount} / ${runtimes.length} 已就绪${catalogStale ? ' · 上次投影' : ''}`}</p></div>
          {unavailable.length > 0 && <span className={styles.waiting}>{unavailable.length} 项降级或失败</span>}
        </div>
        {runtimeCatalogUpdatedAt === null ? <p role="status" className={styles.empty}>正在等待运行体目录，收到投影后自动显示。</p>
          : runtimes.length === 0 ? <div className={styles.empty}><strong>运行体目录为空</strong><p>服务返回了空目录，可前往活动检查启动记录。</p><Link to="/activity">查看启动记录</Link></div>
            : <ul className={styles.runtimeList}>{runtimes.map((runtime) => <li key={runtime.runtime_id}>
              <RuntimeDetails runtime={runtime} catalogUpdatedAt={runtimeCatalogUpdatedAt} stale={catalogStale} />
            </li>)}</ul>}
      </section>

      <section className={styles.configuration} aria-labelledby="overview-model">
        <div className={styles.sectionHead}>
          <div><h2 id="overview-model">对话模型</h2><p>默认模型路由</p></div>
          <Link className={styles.action} to="/settings">配置模型</Link>
        </div>
        {stale ? <p className={styles.waiting}>连接恢复后重新读取模型配置。{route && `上次投影：${route.ready ? '可用' : '不可用'}。`}</p>
          : configurationRead.state === 'loading' ? <p role="status">正在读取模型配置…</p>
            : configurationRead.state === 'error' ? <div className={styles.notice}>
              <p role="alert">{configurationRead.message}</p>
              <button type="button" className={styles.action} onClick={onRetryConfiguration}>重新读取配置</button>
            </div>
              : !route ? <p>尚未收到模型配置。</p>
                : <><strong className={route.ready ? styles.ready : styles.waiting}>{route.ready ? '对话模型可用' : '对话模型不可用'}</strong>
                  <p>{route.ready ? `${route.provider_key ?? '默认 Provider'}${route.model_alias ? ` / ${route.model_alias}` : ''}` : route.reason || '尚未配置默认对话模型。'}</p>
                  {!route.ready && <p>仍可查看运行状态、诊断活动并调整配置。</p>}</>}
      </section>
    </section>
  );
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
