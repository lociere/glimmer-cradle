import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { Copy, Filter } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ContextDrawer } from '../../shared/ui/ContextDrawer/ContextDrawer';
import { SystemNavigation } from '../../shared/ui/SystemNavigation/SystemNavigation';
import { SelectField } from '../../shared/ui/SelectField/SelectField';
import type { ActivityController, ActivitySnapshot } from './ActivityController';
import styles from './Activity.module.css';

export function Activity({ snapshot, controller }: { snapshot: ActivitySnapshot; controller: ActivityController }): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ level: params.get('level') || '', module: params.get('module') || '', trace_id: params.get('trace_id') || '' });
  const [raw, setRaw] = useState(false);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const previousCount = useRef(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const added = Math.max(0, snapshot.entries.length - previousCount.current);
    previousCount.current = snapshot.entries.length;
    if (!follow && added) setUnseen((value) => value + added);
  }, [snapshot.entries.length, follow]);
  useEffect(() => {
    const module = params.get('module') || '';
    const level = params.get('level') || '';
    const trace_id = params.get('trace_id') || '';
    if (module === snapshot.query.module && level === (snapshot.query.level || '') && trace_id === (snapshot.query.trace_id || '')) return;
    const next = { module, level, trace_id };
    setFilters(next);
    void controller.refresh(next);
  }, [controller, params, snapshot.query.level, snapshot.query.module, snapshot.query.trace_id]);
  useLayoutEffect(() => {
    if (!follow || !list.current) return;
    list.current.scrollTop = list.current.scrollHeight;
    setUnseen(0);
  }, [snapshot.entries, follow]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = { level: filters.level, module: filters.module.trim(), trace_id: filters.trace_id.trim() };
      const next = new URLSearchParams(Object.entries(normalized).filter(([, value]) => value));
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [filters.level, filters.module, filters.trace_id, params, setParams]);

  const jumpToLatest = () => {
    setFollow(true); setUnseen(0);
    requestAnimationFrame(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; });
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([snapshot.entries.map((entry) => entry.raw).join('\n')], { type: 'application/x-ndjson' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'personal-server-activity.ndjson'; anchor.click(); URL.revokeObjectURL(url);
  };
  return <section className={`route-view ${styles.activity}`} data-role="view-activity">
    <div className={styles.logPanel}>
      <SystemNavigation />
    <div className={styles.topline}><span>日志</span><div className={styles.actions}><button className={styles.button} data-action="refresh" onClick={() => void controller.refresh()}>刷新</button><button className={styles.button} data-action="export" aria-label="导出当前结果" disabled={!snapshot.entries.length} onClick={download}>导出</button></div></div>
    <div className={styles.filters} aria-label="日志筛选">
      <SelectField label="级别" dataField="level" value={filters.level} options={[{ value: '', label: '全部' }, ...['error', 'warn', 'info', 'debug'].map((level) => ({ value: level, label: level }))]} onChange={(level) => setFilters({ ...filters, level })} />
      <label>模块<input data-field="module" value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} /></label>
      <label>trace_id<input data-field="trace-id" value={filters.trace_id} onChange={(event) => setFilters({ ...filters, trace_id: event.target.value })} /></label>
    </div>
    <div className={styles.streamToolbar}><p role="status" data-role="status-line">{snapshot.loading ? '正在读取最近事件…' : snapshot.connection === 'live' ? '正在观察日志流。' : snapshot.connection === 'retrying' ? '连接中断，正在重试。' : '正在连接日志流…'} 显示 {snapshot.entries.length} 条。{snapshot.paused && ` 已暂停，缓冲 ${snapshot.buffered.length} 条。`}{snapshot.dropped > 0 && ` 已超出缓冲容量，较早的 ${snapshot.dropped} 条未保留。`}</p><div className={styles.actions}><label><input type="checkbox" data-field="pause" checked={snapshot.paused} onChange={(event) => controller.setPaused(event.target.checked)} />暂停</label><label><input type="checkbox" data-field="raw-mode" checked={raw} onChange={(event) => setRaw(event.target.checked)} />原始</label><label><input type="checkbox" data-field="auto-scroll" checked={follow} onChange={(event) => event.target.checked ? jumpToLatest() : setFollow(false)} />自动滚动</label></div></div>
    {snapshot.error && <p role="alert" className={styles.error}>{snapshot.error}</p>}
    <div className={styles.logHeader} aria-hidden="true"><span>时间</span><span>级别</span><span>来源</span><span>消息</span></div>
    <div className={styles.list} ref={list} data-role="log-list" role="region" tabIndex={0} aria-label="事件列表" onScroll={(event) => { const element = event.currentTarget; if (element.scrollHeight - element.scrollTop - element.clientHeight > 40 && follow) setFollow(false); }}>
      {snapshot.initialized && !snapshot.entries.length && <p className={styles.empty}>暂无日志结果，请调整筛选条件。</p>}
      {snapshot.entries.map((entry) => <article key={entry.id} className={styles.entry}>
        <ContextDrawer width="wide" title="事件详情" eyebrow={`${entry.level} · ${entry.source}`} trigger={<Button className={styles.row} aria-label={`查看事件 ${entry.id}`}><time>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className={`${styles.level} ${styles[entry.level] ?? ''}`}>{entry.level}</span><span className={styles.source}>{entry.module}</span><span className={styles.message}>{entry.message}</span></Button>}>
          {(close) => <><div className={styles.detailActions}><button type="button" onClick={() => void navigator.clipboard.writeText(entry.raw)}><Copy aria-hidden="true" size={14} />复制原始日志</button><button type="button" onClick={() => { setFilters({ ...filters, module: entry.module }); close(); }}><Filter aria-hidden="true" size={14} />筛选此来源</button></div><p>{entry.message}</p><dl className={styles.details}><dt>完整时间</dt><dd>{entry.timestamp}</dd><dt>来源</dt><dd>{entry.source}</dd><dt>模块</dt><dd>{entry.module}</dd><dt>Owner</dt><dd>{entry.owner}</dd><dt>运行体</dt><dd>{entry.runtime_id}</dd><dt>Trace</dt><dd>{entry.trace_id || '无'}</dd><dt>事件类型</dt><dd>{entry.event_type}</dd><dt>摘要</dt><dd>{entry.summary || '无'}</dd></dl><h3>原始日志</h3><pre>{entry.raw}</pre></>}
        </ContextDrawer>
        {raw && <pre>{entry.raw}</pre>}
      </article>)}
    </div>
      {!follow && unseen > 0 && <button type="button" className={styles.newEntries} onClick={jumpToLatest}>{unseen} 条新日志 · 回到最新</button>}
    </div>
  </section>;
}
