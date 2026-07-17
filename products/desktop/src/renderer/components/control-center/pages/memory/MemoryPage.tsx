import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader, SurfaceCard } from '../../shared/ui';

type MemorySnapshot = Awaited<ReturnType<Window['desktopHost']['getMemoryPreview']>>;
type MemoryItem = MemorySnapshot['items'][number];

export const MemoryPage: React.FC<{ activeSection: string }> = ({ activeSection }) => {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = React.useCallback(() => {
    setState('loading');
    void window.desktopHost.getMemoryPreview().then((next) => {
      setSnapshot(next);
      setSelectedId((current) => current || next.items[0]?.id || '');
      setState('ready');
    }).catch(() => { setSnapshot(null); setState('error'); });
  }, []);

  useEffect(load, [load]);
  const selected = useMemo(() => snapshot?.items.find((item) => item.id === selectedId) ?? snapshot?.items[0] ?? null, [selectedId, snapshot]);
  const metrics = snapshot?.metrics;

  return (
    <div className="memory-workbench">
      <PageHeader eyebrow="记忆" title={memorySectionTitle(activeSection)} summary="会话、经历、长期记忆与知识保持各自来源；此处只展示 Cognition 提供的受控投影。" actions={<button type="button" className="secondary-action" onClick={load}>刷新</button>} />
      {state === 'loading' && <SurfaceCard><p className="muted-copy">正在读取记忆投影。</p></SurfaceCard>}
      {state === 'error' && <SurfaceCard><p className="error-copy">记忆投影读取失败，请在日志中检查 Cognition 状态。</p></SurfaceCard>}
      {state === 'ready' && snapshot && activeSection === 'preview' && (
        <MemoryBrowser items={snapshot.items} selected={selected} onSelect={setSelectedId} />
      )}
      {state === 'ready' && snapshot && activeSection === 'layers' && (
        <div className="memory-ledger-layout">
          <section className="memory-ledger-summary">
            <span>记忆脊柱</span><h2>{metrics?.durableRecords ?? 0} 条持久记录</h2>
            <p>Moment 先进入不可变经历账本，再投影为 Episode；长期记忆保存可修订结论与证据链接。</p>
          </section>
          <div className="memory-layer-list">
            <MemoryLayer label="Conversation" value={`${metrics?.conversationMessages ?? 0} 条可重建消息`} detail="连续对话记录，不冒充长期记忆" />
            <MemoryLayer label="Moment" value={`${metrics?.experienceMoments ?? 0} 条经历`} detail="保留来源、时间与因果证据" />
            <MemoryLayer label="Episode" value={`${metrics?.episodes ?? 0} 个经历单元`} detail={`${metrics?.pendingConsolidationEpisodes ?? 0} 个等待巩固`} />
            <MemoryLayer label="Memory" value={`${metrics?.activeMemories ?? 0} 条活动记忆`} detail={`${metrics?.memoryRevisions ?? 0} 个修订 / ${metrics?.memoryEvidenceLinks ?? 0} 条证据`} />
          </div>
        </div>
      )}
      {state === 'ready' && snapshot && activeSection === 'knowledge' && (
        <div className="memory-ledger-layout">
          <section className="memory-ledger-summary"><span>知识资料</span><h2>{metrics?.knowledgeEntries ?? 0} 条稳定知识</h2><p>角色资料与稳定知识独立于经历和关系记忆，由上下文组装按需引用。</p></section>
          <div className="memory-preview-list">{snapshot.items.filter((item) => item.source === 'role_knowledge').map((item) => <MemoryPreview key={item.id} item={item} />)}</div>
        </div>
      )}
      {state === 'ready' && snapshot && activeSection === 'attention' && (
        <div className="memory-ledger-layout">
          <section className="memory-ledger-summary"><span>注意力</span><h2>按当前场景组装</h2><p>注意力不会把全部历史塞入提示词，只选择当前对话需要的会话摘要、经历、关系和知识。</p></section>
          <div className="memory-layer-list">
            <MemoryLayer label="最近对话" value={`${metrics?.conversationMessages ?? 0} 条`} detail="维持当前交流连续性" />
            <MemoryLayer label="长期记忆" value={`${metrics?.previewedMemories ?? 0} 条预览`} detail="按相关性与证据进入上下文" />
            <MemoryLayer label="巩固队列" value={`${metrics?.pendingConsolidationEpisodes ?? 0} 个`} detail="后台按事件与预算触发" />
          </div>
        </div>
      )}
    </div>
  );
};

const MemoryBrowser: React.FC<{ items: MemoryItem[]; selected: MemoryItem | null; onSelect: (id: string) => void }> = ({ items, selected, onSelect }) => (
  <div className="memory-layout">
    <aside className="memory-search-panel surface-card">
      <div className="section-title"><h2>最近记录</h2><p>{items.length} 条受控预览</p></div>
      <div className="memory-preview-list">{items.map((item) => (
        <button type="button" key={item.id} aria-current={selected?.id === item.id ? 'true' : undefined} onClick={() => onSelect(item.id)}>
          <span>{memorySourceLabel(item.source)}</span><strong>{item.title}</strong><em>{formatTime(item.timestamp)}</em>
        </button>
      ))}</div>
    </aside>
    <section className="memory-detail-panel surface-card">
      {selected ? <MemoryPreview item={selected} featured /> : <p className="muted-copy">当前没有可展示记录。</p>}
    </section>
  </div>
);

const MemoryPreview: React.FC<{ item: MemoryItem; featured?: boolean }> = ({ item, featured = false }) => (
  <article className={featured ? 'memory-featured-preview' : 'memory-preview-item'}>
    <span>{memorySourceLabel(item.source)}</span><h2>{item.title}</h2><p>{item.body}</p>{item.timestamp && <time>{formatTime(item.timestamp)}</time>}
  </article>
);

const MemoryLayer: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <article className="memory-layer-item"><span>{label}</span><strong>{value}</strong><em>{detail}</em></article>
);

function memorySectionTitle(section: string): string {
  return ({ preview: '最近记录', layers: '经历与记忆', knowledge: '知识资料', attention: '注意力' } as Record<string, string>)[section] ?? '记忆';
}
function memorySourceLabel(source: MemoryItem['source']): string {
  return ({ conversation_message: '会话', experience_moment: '经历 Moment', memory_revision: '长期记忆', role_knowledge: '知识' } as Record<string, string>)[source] ?? source;
}
function formatTime(value?: string): string {
  if (!value) return '稳定资料';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
