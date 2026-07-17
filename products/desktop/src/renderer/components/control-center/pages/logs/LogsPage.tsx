import React, { useEffect, useMemo, useState } from 'react';
import { ListFilter, Pause, Play, RefreshCw, Search } from 'lucide-react';
import type { HealthSnapshot } from '../../model';
import { DiagnosticButton, InfoRows, SelectControl, SurfaceCard } from '../../shared/ui';

type RuntimeReadinessCatalog = Awaited<ReturnType<Window['desktopHost']['getRuntimeReadiness']>>;
type RuntimeReadinessSnapshot = NonNullable<RuntimeReadinessCatalog>['runtimes'][number];
type ObservabilityRecentErrorSummary = Awaited<ReturnType<Window['desktopHost']['getObservabilityRecentErrors']>>[number];
type ObservabilityEventSummary = Awaited<ReturnType<Window['desktopHost']['getObservabilityRecentEvents']>>[number];
type ObservabilityMaintenanceStatus = Awaited<ReturnType<Window['desktopHost']['getObservabilityMaintenance']>>;
type ObservabilityTraceProjection = Awaited<ReturnType<Window['desktopHost']['getObservabilityTrace']>>;
type ObservabilityBundleExportResult = Awaited<ReturnType<Window['desktopHost']['exportObservabilityBundle']>>;
type ObservabilityCleanupResult = Awaited<ReturnType<Window['desktopHost']['cleanupObservability']>>;

export const LogsPage: React.FC<{
  health: HealthSnapshot;
  activeSection: string;
  runtimeReadinessCatalog: RuntimeReadinessCatalog;
  onSectionChange: (section: string) => void;
}> = ({ health, activeSection, runtimeReadinessCatalog, onSectionChange }) => {
  const runtimes = runtimeReadinessCatalog?.runtimes ?? [];
  const readyCount = runtimes.filter((runtime) => runtime.state === 'ready').length;
  const riskCount = runtimes.filter((runtime) => runtime.state === 'degraded' || runtime.state === 'failed').length;
  const blockingCount = runtimes.filter((runtime) => runtime.blocking).length;
  const [recentErrors, setRecentErrors] = useState<ObservabilityRecentErrorSummary[]>([]);
  const [recentEvents, setRecentEvents] = useState<ObservabilityEventSummary[]>([]);
  const [recentEventsState, setRecentEventsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [logQuery, setLogQuery] = useState('');
  const [logLevel, setLogLevel] = useState('all');
  const [logView, setLogView] = useState<'structured' | 'raw'>('structured');
  const [logFollowing, setLogFollowing] = useState(true);
  const [recentErrorsState, setRecentErrorsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [maintenance, setMaintenance] = useState<ObservabilityMaintenanceStatus | null>(null);
  const [maintenanceState, setMaintenanceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [traceInput, setTraceInput] = useState('');
  const [selectedTraceId, setSelectedTraceId] = useState('');
  const [traceProjection, setTraceProjection] = useState<ObservabilityTraceProjection | null>(null);
  const [traceState, setTraceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [traceMessage, setTraceMessage] = useState('');
  const [bundleState, setBundleState] = useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  const [bundleResult, setBundleResult] = useState<ObservabilityBundleExportResult | null>(null);
  const [bundleMessage, setBundleMessage] = useState('');
  const [cleanupState, setCleanupState] = useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  const [cleanupResult, setCleanupResult] = useState<ObservabilityCleanupResult | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState('');

  const loadRecentErrors = React.useCallback(async () => {
    setRecentErrorsState('loading');
    try {
      const items = await window.desktopHost.getObservabilityRecentErrors();
      setRecentErrors(items);
      setRecentErrorsState('ready');
      return items;
    } catch {
      setRecentErrors([]);
      setRecentErrorsState('error');
      return [] as ObservabilityRecentErrorSummary[];
    }
  }, []);

  const loadRecentEvents = React.useCallback(async () => {
    setRecentEventsState((current) => (current === 'ready' ? current : 'loading'));
    try {
      const items = await window.desktopHost.getObservabilityRecentEvents();
      setRecentEvents(items);
      setRecentEventsState('ready');
      return items;
    } catch {
      setRecentEvents([]);
      setRecentEventsState('error');
      return [] as ObservabilityEventSummary[];
    }
  }, []);

  const loadMaintenance = React.useCallback(async () => {
    setMaintenanceState('loading');
    try {
      const next = await window.desktopHost.getObservabilityMaintenance();
      setMaintenance(next);
      setMaintenanceState('ready');
      return next;
    } catch {
      setMaintenance(null);
      setMaintenanceState('error');
      return null;
    }
  }, []);

  const loadTrace = React.useCallback(async (traceId: string) => {
    const normalized = traceId.trim();
    if (!normalized) {
      setTraceProjection(null);
      setTraceState('idle');
      setTraceMessage('');
      return null;
    }

    setTraceState('loading');
    setTraceMessage('');
    try {
      const projection = await window.desktopHost.getObservabilityTrace(normalized);
      setTraceProjection(projection);
      setTraceState('ready');
      return projection;
    } catch (error) {
      setTraceProjection(null);
      setTraceState('error');
      setTraceMessage(error instanceof Error ? error.message : '链路查询失败。');
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [errors] = await Promise.all([
        loadRecentErrors(),
        loadMaintenance(),
      ]);
      if (!cancelled && !selectedTraceId && errors.length > 0) {
        setSelectedTraceId(errors[0].trace_id);
        setTraceInput(errors[0].trace_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMaintenance, loadRecentErrors, selectedTraceId]);

  useEffect(() => {
    if (activeSection !== 'traces') return;
    void loadTrace(selectedTraceId);
  }, [activeSection, loadTrace, selectedTraceId]);

  useEffect(() => {
    if (activeSection !== 'observability') return;
    void loadRecentEvents();
    if (!logFollowing) return;
    const timer = window.setInterval(() => { void loadRecentEvents(); }, 2000);
    return () => window.clearInterval(timer);
  }, [activeSection, loadRecentEvents, logFollowing]);

  const filteredEvents = useMemo(() => {
    const query = logQuery.trim().toLocaleLowerCase();
    return recentEvents.filter((record) => {
      if (logLevel !== 'all' && record.level !== logLevel) return false;
      if (!query) return true;
      return [
        record.timestamp,
        record.level,
        record.event_type,
        record.event_action,
        record.event_outcome,
        record.owner,
        record.module,
        record.runtime_id,
        record.trace_id,
        record.error_code,
        record.diagnostic_hint,
      ].filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
    });
  }, [logLevel, logQuery, recentEvents]);

  const retentionRows = useMemo(() => {
    if (!maintenance) return [];
    return [
      ['索引', `${maintenance.storage.mode} -> ${maintenance.storage.index_path}`],
      ['事件', `${maintenance.retention.events_days} 天`],
      ['链路', `${maintenance.retention.traces_days} 天`],
      ['指标', `${maintenance.retention.metrics_days} 天`],
      ['审计', `${maintenance.retention.audit_days} 天`],
      ['模型摘要', `${maintenance.retention.model_invocation_days} 天`],
      ['模型完整记录', `${maintenance.retention.model_invocation_capture_days} 天`],
      ['应用日志', `${maintenance.retention.application_log_days} 天`],
      ['已处理失败项', `${maintenance.retention.dlq_days} 天`],
      ['诊断包', `${maintenance.retention.bundles_days} 天`],
      ['诊断包目录', maintenance.retention.bundle_export_dir],
    ] as Array<[string, string]>;
  }, [maintenance]);

  async function handleBundleExport(): Promise<void> {
    if (!selectedTraceId.trim()) return;
    setBundleState('running');
    setBundleMessage('');
    try {
      const result = await window.desktopHost.exportObservabilityBundle(selectedTraceId.trim());
      setBundleResult(result);
      setBundleState('ready');
      setBundleMessage(`已导出到 ${result.bundle_root}`);
      await loadMaintenance();
    } catch (error) {
      setBundleResult(null);
      setBundleState('error');
      setBundleMessage(error instanceof Error ? error.message : '诊断包导出失败。');
    }
  }

  async function handleCleanup(): Promise<void> {
    setCleanupState('running');
    setCleanupMessage('');
    try {
      const result = await window.desktopHost.cleanupObservability();
      setCleanupResult(result);
      setCleanupState('ready');
      setCleanupMessage(formatCleanupSummary(result));
      await Promise.all([
        loadMaintenance(),
        loadRecentErrors(),
        loadTrace(selectedTraceId),
      ]);
    } catch (error) {
      setCleanupResult(null);
      setCleanupState('error');
      setCleanupMessage(error instanceof Error ? error.message : '观测清理失败。');
    }
  }

  return (
    <div className="diagnostics-workbench logs-workbench">
      <section className="page-hero">
        <div>
          <span>活动记录</span>
          <h1>日志</h1>
          <p>按一次交互查看模型调用、技能执行和服务状态。</p>
        </div>
      </section>

      {activeSection === 'observability' && (
        <section className="log-explorer" aria-label="日志流">
          <div className="log-explorer-toolbar">
            <label className="log-search-field">
              <Search size={15} />
              <input
                type="search"
                value={logQuery}
                onChange={(event) => setLogQuery(event.target.value)}
                placeholder="筛选事件、模块、trace_id"
                aria-label="筛选日志"
              />
            </label>
            <div className="log-level-filter">
              <ListFilter size={15} />
              <SelectControl ariaLabel="日志级别" value={logLevel} onChange={setLogLevel} options={[
                { value: 'all', label: '全部级别' },
                { value: 'error', label: 'Error' },
                { value: 'warn', label: 'Warn' },
                { value: 'info', label: 'Info' },
                { value: 'debug', label: 'Debug' },
              ]} />
            </div>
            <div className="segmented-control log-view-switch" role="group" aria-label="日志视图">
              <button type="button" className={logView === 'structured' ? 'is-active' : ''} onClick={() => setLogView('structured')}>结构化</button>
              <button type="button" className={logView === 'raw' ? 'is-active' : ''} onClick={() => setLogView('raw')}>原始输出</button>
            </div>
            <button
              type="button"
              className="icon-button tooltip-control"
              aria-label={logFollowing ? '暂停日志刷新' : '继续日志刷新'}
              data-tooltip={logFollowing ? '暂停刷新' : '继续刷新'}
              onClick={() => setLogFollowing((current) => !current)}
            >
              {logFollowing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              type="button"
              className="icon-button tooltip-control"
              aria-label="刷新日志"
              data-tooltip="立即刷新"
              onClick={() => { void loadRecentEvents(); }}
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <div className="log-explorer-meta">
            <span><i className={`connection-dot ${logFollowing ? 'connection-online' : 'connection-idle'}`} />{logFollowing ? '持续刷新' : '已暂停'}</span>
            <span>{filteredEvents.length} / {recentEvents.length} 条</span>
            <span>最近 200 条结构化事件</span>
          </div>

          {recentEventsState === 'loading' && <p className="muted-copy log-explorer-empty">正在读取结构化日志。</p>}
          {recentEventsState === 'error' && <p className="error-copy log-explorer-empty">日志索引当前不可用。</p>}
          {recentEventsState === 'ready' && filteredEvents.length === 0 && <p className="muted-copy log-explorer-empty">没有匹配当前筛选条件的事件。</p>}

          {filteredEvents.length > 0 && logView === 'structured' && (
            <div className="structured-log-table" role="table" aria-label="结构化日志">
              <div className="structured-log-head" role="row">
                <span>时间</span><span>级别</span><span>来源</span><span>事件</span><span>链路</span>
              </div>
              <div className="structured-log-body">
                {filteredEvents.map((record, index) => (
                  <button
                    type="button"
                    className={`structured-log-row ${record.trace_id ? 'has-trace' : ''}`}
                    role="row"
                    key={`${record.timestamp}:${record.event_type}:${index}`}
                    disabled={!record.trace_id}
                    onClick={() => {
                      setTraceInput(record.trace_id);
                      setSelectedTraceId(record.trace_id);
                      onSectionChange('traces');
                    }}
                  >
                    <time>{formatLogTime(record.timestamp)}</time>
                    <span className={`log-level log-level-${record.level}`}>{record.level}</span>
                    <span title={`${record.owner} / ${record.runtime_id}`}>{record.module}</span>
                    <span className="structured-log-event"><strong>{record.event_type}</strong><em>{formatLogEventDetail(record)}</em></span>
                    <code>{shortTraceId(record.trace_id)}</code>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredEvents.length > 0 && logView === 'raw' && (
            <div className="raw-log-view" role="log" aria-label="原始日志输出">
              {filteredEvents.map((record, index) => (
                <button
                  type="button"
                  className={`raw-log-line ${record.trace_id ? 'has-trace' : ''}`}
                  key={`${record.timestamp}:${record.event_type}:raw:${index}`}
                  disabled={!record.trace_id}
                  onClick={() => {
                    setTraceInput(record.trace_id);
                    setSelectedTraceId(record.trace_id);
                    onSectionChange('traces');
                  }}
                >
                  <span className="raw-log-index">{String(index + 1).padStart(3, '0')}</span>
                  <time>{record.timestamp}</time>
                  <span className={`log-level log-level-${record.level}`}>{record.level.toUpperCase()}</span>
                  <span>{record.runtime_id}</span>
                  <strong>{record.event_type}</strong>
                  <em>{formatLogEventDetail(record)}</em>
                  <code>trace={shortTraceId(record.trace_id)}</code>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {activeSection === 'runtime' && (
        <section className="diagnostics-status-grid">
          <StatusTile title="整体" value={health.summary} detail="当前健康状态" tone={health.kernelTone} />
          <StatusTile
            title="服务"
            value={String(runtimes.length)}
            detail={`${readyCount} 个已就绪 / ${riskCount} 个需处理`}
            tone={riskCount > 0 ? 'warn' : runtimes.length > 0 ? 'ready' : 'neutral'}
          />
          <StatusTile
            title="阻塞项"
            value={String(blockingCount)}
            detail="影响当前工作的服务"
            tone={blockingCount > 0 ? 'warn' : 'neutral'}
          />
          <StatusTile
            title="语音"
            value={`TTS ${health.ttsLabel} / ASR ${health.asrLabel}`}
            detail="运行主线摘要"
            tone={health.ttsTone === 'error' || health.asrTone === 'error'
              ? 'error'
              : health.ttsTone === 'ready' || health.asrTone === 'ready'
                ? 'ready'
                : 'warn'}
          />
        </section>
      )}

      <section className="diagnostics-layout">
        {activeSection === 'runtime' && (
          <SurfaceCard title="运行状态">
            {runtimes.length > 0 ? (
              <div className="diagnostic-mainline-list">
                {runtimes.map((runtime) => (
                  <DiagnosticMainlineItem
                    key={runtime.runtime_id}
                    label={runtime.runtime_id}
                    value={runtimeReadinessStateLabel(runtime.state)}
                    tone={runtimeReadinessTone(runtime.state)}
                    detail={`${runtimeReadinessOwnerLabel(runtime.owner)} · ${runtime.phase} · ${runtime.summary}`}
                  />
                ))}
              </div>
            ) : (
              <p className="muted-copy">等待核心上报服务就绪状态。</p>
            )}
          </SurfaceCard>
        )}

        {activeSection === 'runtime' && (
          <SurfaceCard title="资源协调详情">
            {runtimes.some((runtime) => runtime.reconciler) ? (
              <div className="extension-runtime-list">
                {runtimes.filter((runtime) => runtime.reconciler).map((runtime) => (
                  <article className="extension-runtime-card" key={`${runtime.runtime_id}-reconciler`}>
                    <div className="extension-runtime-head">
                      <strong>{runtime.runtime_id}</strong>
                      <em>{runtime.reconciler ? runtimeResourceStateLabel(runtime.reconciler.readiness) : '-'}</em>
                    </div>
                    <InfoRows rows={[
                      ['目标', runtime.reconciler?.desired ?? '-'],
                      ['现状', runtime.reconciler?.actual ?? '-'],
                      ['资源', String(runtime.reconciler?.resources.length ?? 0)],
                      ['详情', runtime.details_ref ?? '-'],
                    ]} />
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-copy">当前服务尚未上报资源协调快照。</p>
            )}
          </SurfaceCard>
        )}

        {activeSection === 'traces' && (
          <SurfaceCard title="最近错误">
            {recentErrorsState === 'loading' && <p className="muted-copy">正在读取最近错误。</p>}
            {recentErrorsState === 'error' && <p className="error-copy">无法读取最近错误。</p>}
            {recentErrorsState === 'ready' && recentErrors.length === 0 && (
              <p className="muted-copy">当前没有可投影的错误链路。</p>
            )}
            {recentErrors.length > 0 && (
              <div className="diagnostic-trace-list">
                {recentErrors.map((item) => (
                  <button
                    type="button"
                    key={`${item.trace_id}:${item.timestamp}`}
                    className={`diagnostic-trace-item ${selectedTraceId === item.trace_id ? 'diagnostic-trace-item-active' : ''}`}
                    onClick={() => {
                      setSelectedTraceId(item.trace_id);
                      setTraceInput(item.trace_id);
                    }}
                  >
                    <div className="diagnostic-trace-head">
                      <strong>{item.title}</strong>
                      <span>{item.timestamp}</span>
                    </div>
                    <p>{item.summary}</p>
                    <em>{[item.source, item.owner, item.error_code].filter(Boolean).join(' / ')}</em>
                  </button>
                ))}
              </div>
            )}
          </SurfaceCard>
        )}

        {activeSection === 'traces' && (
          <SurfaceCard title="链路查询与导出" className="diagnostic-trace-card">
            <div className="diagnostic-trace-query">
              <label className="diagnostic-trace-input">
                <span>trace_id</span>
                <input
                  value={traceInput}
                  onChange={(event) => setTraceInput(event.target.value)}
                  placeholder="输入 trace_id"
                />
              </label>
              <div className="diagnostic-maintenance-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    const next = traceInput.trim();
                    if (!next) return;
                    setSelectedTraceId(next);
                  }}
                >
                  查询
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => { void handleBundleExport(); }}
                  disabled={!selectedTraceId.trim() || bundleState === 'running'}
                >
                  {bundleState === 'running' ? '导出中…' : '导出诊断包'}
                </button>
              </div>
            </div>

            {bundleMessage && (
              <div className="diagnostic-maintenance-status">
                <p>{bundleMessage}</p>
              </div>
            )}
          </SurfaceCard>
        )}

        {activeSection === 'traces' && (
          <SurfaceCard title={selectedTraceId ? `链路 ${selectedTraceId}` : '链路详情'} className="diagnostic-trace-card">
            {traceState === 'idle' && <p className="muted-copy">选择最近错误，或手动输入 trace_id。</p>}
            {traceState === 'loading' && <p className="muted-copy">正在读取 trace projection。</p>}
            {traceState === 'error' && <p className="error-copy">{traceMessage || '链路查询失败。'}</p>}
            {traceProjection && traceState === 'ready' && (
              <div className="diagnostic-trace-stack">
                <div className="diagnostic-trace-pills">
                  <TraceSummaryPill label="事件" value={String(traceProjection.events.length)} />
                  <TraceSummaryPill label="审计" value={String(traceProjection.audit.length)} />
                  <TraceSummaryPill label="模型" value={String(traceProjection.modelInvocations.length)} />
                  <TraceSummaryPill label="失败项" value={String(traceProjection.dlq.length)} />
                  <TraceSummaryPill label="区段" value={String(traceProjection.spans.length)} />
                  <TraceSummaryPill label="进程" value={String(traceProjection.process_log_refs.length)} />
                </div>

                <InfoRows rows={[
                  ['Storage', traceProjection.storage.mode],
                  ['索引', traceProjection.storage.index_path],
                  ['索引刷新时间', traceProjection.storage.refreshed_at ?? '-'],
                  ['关联服务', traceProjection.related_runtime_ids.join(', ') || '-'],
                  ['关联 Provider', traceProjection.related_providers.join(', ') || '-'],
                ]} />

                <div className="diagnostic-trace-grid">
                  <TraceSection
                    title="事件"
                    empty="没有匹配的结构化事件。"
                    items={traceProjection.events.slice(0, 10).map((record) => ({
                      key: `${record.timestamp}:${record.event_type}`,
                      title: record.event_type,
                      meta: [record.timestamp, record.level, record.runtime_id, record.error_code].filter(Boolean).join(' / '),
                      body: [record.event_action, record.event_outcome, record.diagnostic_hint].filter(Boolean).join(' / ') || record.module,
                    }))}
                  />
                  <TraceSection
                    title="审计"
                    empty="没有匹配的审计记录。"
                    items={traceProjection.audit.slice(0, 8).map((record) => ({
                      key: `${record.timestamp}:${record.action}`,
                      title: record.action,
                      meta: [record.timestamp, record.outcome, record.runtime_id].filter(Boolean).join(' / '),
                      body: [record.target_kind, record.reason, record.diagnostic_hint].filter(Boolean).join(' / '),
                    }))}
                  />
                  <TraceSection
                    title="模型调用摘要"
                    empty="没有匹配的模型调用记录。"
                    items={traceProjection.modelInvocations.slice(0, 6).map((record) => ({
                      key: `${record.timestamp}:${record.invocation_id}`,
                      title: `${record.provider_id} / ${record.model_id}`,
                      meta: [record.timestamp, record.outcome, record.capture_mode].join(' / '),
                      body: [record.purpose, record.error_code, record.error_summary].filter(Boolean).join(' / '),
                    }))}
                  />
                  <TraceSection
                    title="失败队列摘要"
                    empty="没有匹配的 DLQ 记录。"
                    items={traceProjection.dlq.slice(0, 6).map((record) => ({
                      key: `${record.id}:${record.created_at}`,
                      title: record.event_type,
                      meta: [record.created_at, record.status, record.failure_phase, record.error_code].filter(Boolean).join(' / '),
                      body: [record.diagnostic_hint, record.redacted_payload_summary, record.replay_command].filter(Boolean).join(' / '),
                    }))}
                  />
                  <TraceSection
                    title="Spans"
                    empty="没有匹配的 span。"
                    items={traceProjection.spans.slice(0, 8).map((record) => ({
                      key: `${record.span_id}:${record.started_at}`,
                      title: record.name,
                      meta: [record.started_at, record.status, `${Math.round(record.duration_ms)} ms`, record.source].filter(Boolean).join(' / '),
                      body: [record.file_ref, record.parent_span_id ?? 'root'].filter(Boolean).join(' / '),
                    }))}
                  />
                  <TraceSection
                    title="进程日志引用"
                    empty="没有关联到 process log。"
                    items={traceProjection.process_log_refs.map((record) => ({
                      key: record.id,
                      title: record.label,
                      meta: [record.owner, record.exists ? 'exists' : 'missing', record.source].join(' / '),
                      body: record.path,
                    }))}
                  />
                </div>

                {traceProjection.metric_refs.length > 0 && (
                  <div className="diagnostic-trace-notes">
                    <strong>Metric refs</strong>
                    {traceProjection.metric_refs.map((record) => (
                      <p key={record.id}>{record.path} / {record.note}</p>
                    ))}
                  </div>
                )}

                {traceProjection.notes.length > 0 && (
                  <div className="diagnostic-trace-notes">
                    <strong>Notes</strong>
                    {traceProjection.notes.map((note) => <p key={note}>{note}</p>)}
                  </div>
                )}

                {bundleResult && bundleResult.trace_id === traceProjection.trace_id && (
                  <div className="diagnostic-trace-notes">
                    <strong>Latest bundle</strong>
                    <p>{bundleResult.bundle_root}</p>
                    <p>{bundleResult.manifest_path}</p>
                  </div>
                )}

              </div>
            )}
          </SurfaceCard>
        )}

        {activeSection === 'logs' && (
          <SurfaceCard title="日志位置">
            <div className="diagnostic-action-groups">
              <div className="diagnostic-action-group">
                <strong>运行记录</strong>
                <div className="diagnostic-actions">
                  <DiagnosticButton label="启动摘要" location="kernelPrettyLog" />
                  <DiagnosticButton label="Kernel 记录" location="kernelLog" />
                  <DiagnosticButton label="日志目录" location="logs" />
                </div>
              </div>
              <div className="diagnostic-action-group">
                <strong>能力记录</strong>
                <div className="diagnostic-actions">
                  <DiagnosticButton label="对话" location="cognitionLog" />
                  <DiagnosticButton label="TTS" location="audioTtsLog" />
                  <DiagnosticButton label="ASR" location="audioAsrLog" />
                </div>
              </div>
              <div className="diagnostic-action-group">
                <strong>形象记录</strong>
                <div className="diagnostic-actions">
                  <DiagnosticButton label="形象日志" location="avatarHostLog" />
                  <DiagnosticButton label="构建日志" location="avatarHostBuildLog" />
                  <DiagnosticButton label="形象产物" location="avatarHostPackage" />
                </div>
              </div>
            </div>
          </SurfaceCard>
        )}

        {activeSection === 'logs' && (
          <SurfaceCard title="保留与维护">
            {maintenanceState === 'loading' && <p className="muted-copy">正在读取维护状态。</p>}
            {maintenanceState === 'error' && <p className="error-copy">无法读取维护状态。</p>}
            {maintenance && (
              <div className="diagnostic-maintenance-card">
                <InfoRows rows={retentionRows} />
                <p className="muted-copy">
                  模型记录模式：{maintenance.model_invocation_capture_mode}；诊断包{maintenance.retention.include_model_invocation_captures ? '包含' : '不包含'}完整模型输入输出。
                </p>
                {maintenance.notes.length > 0 && (
                  <div className="diagnostic-trace-notes">
                    {maintenance.notes.map((note) => <p key={note}>{note}</p>)}
                  </div>
                )}
              </div>
            )}
            <div className="diagnostic-maintenance-actions maintenance-footer-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => { void handleCleanup(); }}
                disabled={cleanupState === 'running'}
              >
                {cleanupState === 'running' ? '清理中…' : '按保留策略清理'}
              </button>
            </div>
            {cleanupMessage && <p className="diagnostic-maintenance-status">{cleanupMessage}</p>}
            {cleanupResult && cleanupResult.buckets.some((bucket) => bucket.deleted_records > 0 || bucket.deleted_files > 0) && (
              <div className="diagnostic-trace-notes">
                {cleanupResult.buckets
                  .filter((bucket) => bucket.deleted_records > 0 || bucket.deleted_files > 0)
                  .map((bucket) => <p key={bucket.id}>{bucket.id}: {bucket.deleted_records} records / {bucket.deleted_files} files</p>)}
              </div>
            )}
          </SurfaceCard>
        )}

      </section>
    </div>
  );
};

const StatusTile: React.FC<{
  title: string;
  value: string;
  detail: string;
  tone: 'ready' | 'warn' | 'error' | 'neutral';
}> = ({ title, value, detail, tone }) => (
  <article className={`status-tile status-tile-${tone}`}>
    <span className="status-tile-mark" />
    <div>
      <span>{title}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  </article>
);

const DiagnosticMainlineItem: React.FC<{
  label: string;
  value: string;
  tone: 'ready' | 'warn' | 'error' | 'neutral';
  detail: string;
}> = ({ label, value, tone, detail }) => (
  <div className={`diagnostic-mainline-item diagnostic-mainline-${tone}`}>
    <span className="status-tile-mark" />
    <div>
      <strong>{label}</strong>
      <em>{detail}</em>
    </div>
    <b>{value}</b>
  </div>
);

const TraceSummaryPill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="diagnostic-trace-pill">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const TraceSection: React.FC<{
  title: string;
  empty: string;
  items: Array<{
    key: string;
    title: string;
    meta: string;
    body: string;
  }>;
}> = ({ title, empty, items }) => (
  <section className="diagnostic-trace-section">
    <h2>{title}</h2>
    {items.length === 0 ? (
      <p className="muted-copy">{empty}</p>
    ) : (
      <div className="diagnostic-trace-records">
        {items.map((item) => (
          <article key={item.key} className="diagnostic-trace-record">
            <div className="diagnostic-trace-head">
              <strong>{item.title}</strong>
              <span>{item.meta}</span>
            </div>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    )}
  </section>
);

function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatLogEventDetail(record: ObservabilityEventSummary): string {
  return [record.event_action, record.event_outcome, record.error_code, record.diagnostic_hint]
    .filter(Boolean)
    .join(' / ') || record.owner;
}

function shortTraceId(traceId: string): string {
  if (traceId.length <= 12) return traceId;
  return `${traceId.slice(0, 8)}…${traceId.slice(-4)}`;
}

function runtimeReadinessTone(
  state: 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped',
): 'ready' | 'warn' | 'error' | 'neutral' {
  if (state === 'ready') return 'ready';
  if (state === 'failed') return 'error';
  if (state === 'degraded' || state === 'starting') return 'warn';
  return 'neutral';
}

function runtimeReadinessStateLabel(
  state: 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped',
): string {
  if (state === 'ready') return 'ready';
  if (state === 'failed') return 'failed';
  if (state === 'degraded') return 'degraded';
  if (state === 'starting') return 'starting';
  return 'stopped';
}

function runtimeReadinessOwnerLabel(
  owner: 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension',
): string {
  if (owner === 'kernel') return 'Kernel';
  if (owner === 'cognition') return 'Cognition';
  if (owner === 'engine') return 'Engine';
  if (owner === 'renderer') return 'Renderer';
  return 'Extension';
}

function runtimeResourceStateLabel(
  state: 'pending' | 'ready' | 'missing' | 'degraded' | 'failed' | 'unknown',
): string {
  if (state === 'ready') return 'ready';
  if (state === 'missing') return 'missing';
  if (state === 'degraded') return 'degraded';
  if (state === 'failed') return 'failed';
  if (state === 'pending') return 'pending';
  return 'unknown';
}

function formatCleanupSummary(result: ObservabilityCleanupResult): string {
  const touched = result.buckets.filter((bucket) => bucket.deleted_records > 0 || bucket.deleted_files > 0);
  if (touched.length === 0) {
    return '清理完成，没有命中可删除的观测数据。';
  }
  return touched
    .map((bucket) => `${bucket.id}: ${bucket.deleted_records} records / ${bucket.deleted_files} files`)
    .join(' | ');
}
