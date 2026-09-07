import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isPending, type ConversationSnapshot } from './ConversationController';
import styles from './Conversation.module.css';

export interface ConversationProps {
  readonly snapshot: ConversationSnapshot;
  readonly onSend: (text: string) => boolean;
  readonly onRetry: (id: string) => void;
  readonly onRefresh: () => void;
  readonly onLoadOlder: () => void;
}

const allowedActions = new Set(['conversation', 'overview', 'settings', 'activity', 'capabilities']);
const roleLabels = { user: '你', assistant: '回复', system: '提示' };
const statusLabels = { pending: '已提交，等待处理', thinking: '处理中', failed: '未完成', committed: '', notice: '提示' };

export function Conversation({ snapshot, onSend, onRetry, onRefresh, onLoadOlder }: ConversationProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const olderAnchor = useRef<{ height: number; top: number } | null>(null);
  const busy = snapshot.entries.some(isPending);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (olderAnchor.current && !snapshot.loadingOlder) {
      list.scrollTop = olderAnchor.current.top + list.scrollHeight - olderAnchor.current.height;
      olderAnchor.current = null;
    } else if (followLatest.current && !snapshot.loadingOlder) list.scrollTop = list.scrollHeight;
  }, [snapshot.entries, snapshot.loadingOlder]);
  const banner = !snapshot.connected ? '控制面已断开连接。历史仍可见，恢复连接后可继续发送。'
    : snapshot.loading ? '正在从服务端恢复最新历史…'
      : snapshot.error ? `历史读取失败：${snapshot.error}`
        : snapshot.nextCursor ? '已恢复最新一页历史，可继续向前翻页。'
          : snapshot.initialized ? '当前历史已完整恢复。' : '等待读取对话历史。';

  return <section className={`route-view ${styles.conversation}`} data-role="view-conversation">
    <header className={styles.header}><h1>当前对话</h1><Link to="/overview">查看连接与能力</Link></header>
    <div className={styles.toolbar}>
      <p data-role="conversation-banner" role={snapshot.error ? 'alert' : 'status'} className={snapshot.error || !snapshot.connected ? styles.warning : ''}>{banner}</p>
      <button type="button" onClick={onRefresh} disabled={!snapshot.connected || snapshot.loading || snapshot.loadingOlder}>{snapshot.error ? '重新读取历史' : '刷新历史'}</button>
    </div>
    {snapshot.nextCursor && <button className={styles.older} type="button" disabled={!snapshot.connected || snapshot.loading || snapshot.loadingOlder} onClick={() => {
      if (listRef.current) olderAnchor.current = { height: listRef.current.scrollHeight, top: listRef.current.scrollTop };
      onLoadOlder();
    }}>{snapshot.loadingOlder ? '正在读取更早消息…' : '加载更早消息'}</button>}
    <ol className={styles.messages} data-role="message-list" aria-label="对话消息" tabIndex={0} ref={listRef} onScroll={() => {
      const list = listRef.current;
      if (list) followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    }}>
      {snapshot.entries.length === 0 && <li className={styles.empty} data-role="empty-state">
        <h2>{snapshot.loading || !snapshot.initialized ? '等待对话历史' : '开始一段对话'}</h2>
        <p>{snapshot.error ? '暂时无法读取历史，可使用上方按钮重试。' : snapshot.initialized ? '写下想说的话，开始新的交流。' : '连接恢复后，会自动读取最近的消息。'}</p>
      </li>}
      {snapshot.entries.map((entry) => <li key={entry.id} className={`${styles.message} ${styles[entry.role]}`} data-message-id={entry.id}>
        <article aria-label={`${roleLabels[entry.role]}的消息`}>
          <div className={styles.meta}><span>{roleLabels[entry.role]}</span><time dateTime={entry.time}>{new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false })}</time></div>
          {entry.title && <strong>{entry.title}</strong>}
          <div className={styles.body}>{entry.text}</div>
          {statusLabels[entry.status] && <p className={entry.status === 'failed' ? styles.warning : styles.meta}>{statusLabels[entry.status]}</p>}
          {entry.actionRoute && allowedActions.has(entry.actionRoute) && <Link to={`/${entry.actionRoute}`}>{entry.actionLabel || '查看相关设置'}</Link>}
          {entry.role === 'user' && entry.status === 'failed' && <button type="button" disabled={!snapshot.connected || busy} onClick={() => onRetry(entry.id)}>重试</button>}
        </article>
      </li>)}
    </ol>
    <form className={styles.composer} data-role="composer-form" onSubmit={(event) => {
      event.preventDefault();
      if (onSend(draft)) { setDraft(''); followLatest.current = true; inputRef.current?.focus(); }
    }}>
      <label htmlFor="conversation-message">消息</label>
      <textarea id="conversation-message" ref={inputRef} rows={3} maxLength={8000} placeholder="和当前角色说点什么…" data-role="message-input" value={draft} onChange={(event) => setDraft(event.target.value)} aria-describedby="conversation-send-state" />
      <div className={styles.composerFooter}><p id="conversation-send-state" role="status">{snapshot.sendError || (!snapshot.connected ? '连接恢复后可发送；草稿保留在当前页面。' : busy ? '正在等待本次对话完成…' : 'Enter 换行，点击发送。')}</p>
        <button type="submit" className={styles.send} data-role="send-button" disabled={!snapshot.connected || busy || !draft.trim()}>{busy ? '等待回复' : '发送'}</button></div>
    </form>
  </section>;
}
