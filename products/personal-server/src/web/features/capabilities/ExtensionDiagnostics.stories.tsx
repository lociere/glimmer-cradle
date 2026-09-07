import type { Meta, StoryObj } from '@storybook/react';
import type { ExtensionRuntimeProjection } from '../../../shared/control-center-models';
import { ExtensionDiagnostics } from './ExtensionDiagnostics';

const projection: ExtensionRuntimeProjection = {
  schema: 'glimmer-cradle.extension.runtime-projection', extension_id: 'community.echo',
  permissions: [], tags: [], lifecycle: 'running', contribution_points: [], actions: [],
  capability_graph: { nodes: [{ id: 'reply', title: '消息回复', contribution_point: 'glimmer.protocolBridge', kind: 'protocol_bridge', state: 'degraded', owner: 'extension', audience: 'adapter', required: true, summary: '连接等待恢复。', permissions: [], readiness_gates: [{ id: 'connection', kind: 'connection', state: 'failed', summary: '外部服务未连接。', checked_at: '2026-09-07T08:00:00Z', error_message: '连接超时，请检查外部服务。' }], diagnostic_refs: [], metadata: {}, updated_at: '2026-09-07T08:00:00Z' }], edges: [] },
  diagnostics: { summary: '外部连接降级。', entries: [], log_locations: [], recovery_actions: ['确认外部服务已启动，然后刷新状态。'] }, updated_at: '2026-09-07T08:00:00Z',
};
const meta = { title: 'Features/ExtensionDiagnostics', component: ExtensionDiagnostics, args: { projection } } satisfies Meta<typeof ExtensionDiagnostics>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Degraded: Story = {};
export const Missing: Story = { args: { projection: undefined } };
export const Empty: Story = { args: { projection: { ...projection, capability_graph: { nodes: [], edges: [] } } } };
export const Unknown: Story = { args: { projection: { ...projection, capability_graph: { nodes: [{ ...projection.capability_graph.nodes[0], state: '__proto__', title: '长能力名称'.repeat(30) }], edges: [] } } } };
