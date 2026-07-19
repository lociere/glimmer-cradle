import type {
  CapabilityGraphNode,
  ExtensionRuntimeProjection,
} from '@glimmer-cradle/protocol';
import type { SkillProviderRuntimeSnapshot } from '../../types';

export function toExtensionProviderRuntimeSnapshot(
  projection: ExtensionRuntimeProjection,
): SkillProviderRuntimeSnapshot {
  const state = resolveExtensionProviderRuntimeState(projection);
  const summary = resolveExtensionProviderRuntimeSummary(projection, state);
  const counts = countCharacterSkillNodes(projection);
  return {
    provider: {
      kind: 'extension',
      id: projection.extension_id,
    },
    display_name: projection.display_name || projection.extension_id,
    state,
    summary,
    skill_count: counts.skill_count,
    tool_count: counts.tool_count,
    resource_count: counts.resource_count,
    prompt_count: counts.prompt_count,
    error: projection.diagnostics.last_error,
    recovery_actions: projection.diagnostics.recovery_actions ?? [],
    metadata: {
      lifecycle: projection.lifecycle,
      capability_node_count: projection.capability_graph.nodes.length,
      action_intent_count: projection.actions.length,
      contribution_point_count: projection.contribution_points.length,
    },
    updated_at: projection.updated_at,
  };
}

function resolveExtensionProviderRuntimeState(
  projection: ExtensionRuntimeProjection,
): SkillProviderRuntimeSnapshot['state'] {
  switch (projection.lifecycle) {
    case 'discovered':
    case 'loaded':
      return 'contract_only';
    case 'starting':
    case 'stopping':
      return 'connecting';
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'unavailable';
    case 'degraded':
      return 'degraded';
    case 'running':
      return resolveRunningState(projection.capability_graph.nodes);
    default:
      return 'contract_only';
  }
}

function resolveRunningState(
  nodes: readonly CapabilityGraphNode[],
): SkillProviderRuntimeSnapshot['state'] {
  const requiredNodes = nodes.filter((node) => node.required);
  const nodeSet = requiredNodes.length > 0 ? requiredNodes : nodes;
  if (nodeSet.some((node) => node.state === 'failed' || node.state === 'unavailable')) {
    return 'unavailable';
  }
  if (nodeSet.some((node) => node.state === 'degraded')) {
    return 'degraded';
  }
  if (nodeSet.some((node) => (
    node.state === 'declared'
    || node.state === 'preparing'
    || node.state === 'starting'
    || node.state === 'live'
  ))) {
    return 'connecting';
  }
  return 'ready';
}

function resolveExtensionProviderRuntimeSummary(
  projection: ExtensionRuntimeProjection,
  state: SkillProviderRuntimeSnapshot['state'],
): string {
  if (state === 'ready') return 'Extension provider 已就绪。';
  if (state === 'connecting' && projection.lifecycle === 'running') {
    return 'Extension provider 已启动，等待受管资源与能力节点就绪。';
  }
  if (projection.diagnostics.last_error?.trim()) {
    return projection.diagnostics.last_error;
  }
  if (projection.summary?.trim()) {
    return projection.summary;
  }
  switch (state) {
    case 'contract_only':
      return 'Extension provider 已声明，等待运行时激活。';
    case 'connecting':
      return 'Extension provider 正在准备运行时与依赖资源。';
    case 'degraded':
      return 'Extension provider 处于降级状态。';
    case 'unavailable':
      return 'Extension provider 当前不可用。';
    case 'stopped':
      return 'Extension provider 已停止。';
    default:
      return 'Extension provider 状态未知。';
  }
}

function countCharacterSkillNodes(projection: ExtensionRuntimeProjection): {
  skill_count: number;
  tool_count: number;
  resource_count: number;
  prompt_count: number;
} {
  let skillCount = 0;
  let toolCount = 0;
  let resourceCount = 0;
  let promptCount = 0;
  for (const node of projection.capability_graph.nodes) {
    if (node.audience !== 'character') {
      continue;
    }
    if (node.contribution_point !== 'glimmer.skill') {
      continue;
    }
    skillCount += 1;
    switch (node.kind) {
      case 'tool':
        toolCount += 1;
        break;
      case 'resource':
        resourceCount += 1;
        break;
      case 'prompt':
        promptCount += 1;
        break;
      default:
        toolCount += 1;
        break;
    }
  }
  return {
    skill_count: skillCount,
    tool_count: toolCount,
    resource_count: resourceCount,
    prompt_count: promptCount,
  };
}
