import type { ExtensionRuntimeProjection } from '../../../shared/control-center-models';
import styles from './Extensions.module.css';

const stateLabels: Record<string, string> = {
  declared: '已声明', preparing: '准备中', live: '活跃',
  ready: '已就绪', running: '运行中', degraded: '已降级', failed: '失败',
  disabled: '已禁用', unsupported: '不支持', registered: '已注册',
  pending: '等待中', unknown: '未知', stopped: '已停止', starting: '启动中',
  available: '可用', unavailable: '不可用', passed: '通过', blocked: '受阻',
};
const stateLabel = (state: string) => Object.hasOwn(stateLabels, state) ? stateLabels[state] : `未知状态（${state || '未提供'}）`;

export function ExtensionDiagnostics({ projection }: { projection?: ExtensionRuntimeProjection }): JSX.Element {
  if (!projection) return <section aria-label="能力与诊断"><h3>能力与诊断</h3><p>尚无运行投影，无法判断能力是否就绪。</p></section>;
  const { capability_graph: graph, diagnostics } = projection;
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const unsupported = projection.contribution_points.filter(point => point.state === 'unsupported');
  return <section aria-label="能力与诊断" className={styles.diagnostics}>
    <h3>能力与诊断</h3>
    {graph.nodes.length === 0 ? <p>扩展尚未报告能力明细。进程状态不能代表各项能力已就绪。</p> : <>
      <p>共 {graph.nodes.length} 项能力。展开查看就绪条件与依赖。</p>
      {graph.nodes.map(node => <details className={styles.node} key={node.id}>
        <summary><strong>{node.title || node.id}</strong><span>{stateLabel(node.state)}</span></summary>
        <p>{node.summary || '暂无状态说明。'}</p>
        {node.description && <p>{node.description}</p>}
        <dl className={styles.facts}><dt>标识</dt><dd>{node.id}</dd><dt>贡献点</dt><dd>{node.contribution_point}</dd><dt>必要性</dt><dd>{node.required ? '必需' : '可选'}</dd><dt>权限</dt><dd>{node.permissions.join('、') || '无'}</dd></dl>
        <h4>就绪条件</h4>
        {node.readiness_gates.length === 0 ? <p>未报告具体就绪条件。</p> : <ul className={styles.diagnosticList}>{node.readiness_gates.map(gate => <li key={gate.id}>
          <strong>{gate.id} · {stateLabel(gate.state)}</strong>
          <p>{gate.summary || '暂无检查说明。'}</p>
          {gate.error_message && <p className={styles.error}>{gate.error_message}</p>}
          <small>检查时间：{gate.checked_at || '未提供'}{gate.latency_ms !== undefined ? ` · 耗时 ${gate.latency_ms} ms` : ''}{gate.error_code ? ` · 错误码 ${gate.error_code}` : ''}</small>
        </li>)}</ul>}
        {graph.edges.some(edge => edge.from === node.id) && <><h4>关联能力</h4><ul className={styles.diagnosticList}>{graph.edges.filter(edge => edge.from === node.id).map((edge, index) => <li key={`${edge.to}:${index}`}>
          {nodes.get(edge.to)?.title || edge.to} · {edge.summary || edge.relation}
          {edge.required_state && <span> · 要求：{stateLabel(edge.required_state)}</span>}
        </li>)}</ul></>}
      </details>)}
    </>}
    {unsupported.length > 0 && <><h4>不支持的贡献点</h4><ul className={styles.diagnosticList}>{unsupported.map(point => <li key={point.id}>{point.title || point.id} · {point.id}</li>)}</ul></>}
    {diagnostics.recovery_actions.length > 0 && <><h4>恢复建议</h4><ul className={styles.diagnosticList}>{diagnostics.recovery_actions.map((action, index) => <li key={index}>{action}</li>)}</ul></>}
    {diagnostics.trace_id && <p>诊断追踪：{diagnostics.trace_id}</p>}
  </section>;
}
