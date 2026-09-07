import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { ActivityController, ActivitySnapshot } from './ActivityController';
import styles from './Activity.module.css';

export function Activity({ snapshot, controller }: { snapshot: ActivitySnapshot; controller: ActivityController }): JSX.Element {
  const [filters, setFilters] = useState({ level: '', module: '', trace_id: '' });
  const [raw, setRaw] = useState(false);
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (follow && list.current) list.current.scrollTop = 0; }, [snapshot.entries, follow]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([snapshot.entries.map((entry) => entry.raw).join('\n')], { type: 'application/x-ndjson' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'personal-server-activity.ndjson'; anchor.click(); URL.revokeObjectURL(url);
  };
  return <section className={`route-view ${styles.activity}`} data-role="view-activity">
    <header className={styles.header}><div><h1>活动</h1><p>筛选最近事件，观察运行变化。</p></div><div className={styles.actions}><button className={styles.button} data-action="refresh" onClick={() => void controller.refresh()}>刷新</button><button className={styles.button} data-action="export" disabled={!snapshot.entries.length} onClick={download}>导出当前结果</button></div></header>
    <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); void controller.refresh({ level: filters.level, module: filters.module.trim(), trace_id: filters.trace_id.trim() }); }}>
      <label>级别<select data-field="level" value={filters.level} onChange={(event) => setFilters({ ...filters, level: event.target.value })}><option value="">全部</option>{['error', 'warn', 'info', 'debug'].map((level) => <option key={level}>{level}</option>)}</select></label>
      <label>模块<input data-field="module" value={filters.module} onChange={(event) => setFilters({ ...filters, module: event.target.value })} /></label>
      <label>trace_id<input data-field="trace-id" value={filters.trace_id} onChange={(event) => setFilters({ ...filters, trace_id: event.target.value })} /></label>
      <button className={styles.button} data-action="apply" type="submit">应用筛选</button>
    </form>
    <div className={styles.actions}><label><input type="checkbox" data-field="pause" checked={snapshot.paused} onChange={(event) => controller.setPaused(event.target.checked)} />暂停</label><label><input type="checkbox" data-field="raw-mode" checked={raw} onChange={(event) => setRaw(event.target.checked)} />原始</label><label><input type="checkbox" data-field="auto-scroll" checked={follow} onChange={(event) => setFollow(event.target.checked)} />自动滚动</label></div>
    <p role="status" data-role="status-line">{snapshot.loading ? '正在读取最近事件…' : snapshot.connection === 'live' ? '正在观察日志流。' : snapshot.connection === 'retrying' ? '连接中断，正在重试。' : '正在连接日志流…'} 显示 {snapshot.entries.length} 条。{snapshot.paused && ` 已暂停，缓冲 ${snapshot.buffered.length} 条。`}{snapshot.dropped > 0 && ` 已超出缓冲容量，较早的 ${snapshot.dropped} 条未保留。`}</p>
    {snapshot.error && <p role="alert">{snapshot.error}</p>}
    <div className={styles.list} ref={list} data-role="log-list" role="region" tabIndex={0} aria-label="事件列表">
      {snapshot.initialized && !snapshot.entries.length && <p>暂无日志结果，请调整筛选条件。</p>}
      {snapshot.entries.map((entry) => <article key={entry.id} className={styles.entry}>
        <DialogTrigger><Button className={styles.row} aria-label={`查看事件 ${entry.id}`}><strong>{entry.module}</strong><span>{entry.level} · {entry.source} · {new Date(entry.timestamp).toLocaleTimeString()}</span><span className={styles.message}>{entry.message}</span><small>{entry.event_type} · {entry.trace_id || '无 trace'}</small></Button>
          <ModalOverlay className={styles.scrim} isDismissable><Modal className={styles.drawer}><Dialog className={styles.dialog}>{({ close }) => <><div className={styles.header}><Heading slot="title">事件详情</Heading><Button className={styles.button} onPress={close} autoFocus>关闭详情</Button></div><p>{entry.module} · {entry.level}</p><p>{entry.message}</p><dl><dt>时间</dt><dd>{entry.timestamp}</dd><dt>来源</dt><dd>{entry.source}</dd><dt>Owner</dt><dd>{entry.owner}</dd><dt>运行体</dt><dd>{entry.runtime_id}</dd><dt>Trace</dt><dd>{entry.trace_id || '无'}</dd><dt>事件类型</dt><dd>{entry.event_type}</dd><dt>摘要</dt><dd>{entry.summary || '无'}</dd></dl><h3>原始日志</h3><pre>{entry.raw}</pre></>}</Dialog></Modal></ModalOverlay>
        </DialogTrigger>{raw && <pre>{entry.raw}</pre>}
      </article>)}
    </div>
  </section>;
}
