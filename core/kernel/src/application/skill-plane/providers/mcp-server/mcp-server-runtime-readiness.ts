import type { RuntimeReadinessSnapshot } from '../../../../foundation/runtime-readiness';
import {
  strongestRuntimeResourceState,
  type RuntimeResourceSnapshot,
} from '../../../../foundation/runtime-reconciler';
import type { SkillProviderRuntimeSnapshot } from '../../types';

export function buildMcpRuntimeReadinessSnapshots(
  providerRuntimes: readonly SkillProviderRuntimeSnapshot[],
): RuntimeReadinessSnapshot[] {
  const mcpRuntimes = providerRuntimes
    .filter((runtime) => runtime.provider.kind === 'mcp_server')
    .sort((left, right) => left.provider.id.localeCompare(right.provider.id));
  const serverSnapshots = mcpRuntimes.map((runtime) => buildMcpProviderReadinessSnapshot(runtime));
  return [
    buildMcpAggregateReadinessSnapshot(serverSnapshots),
    ...serverSnapshots,
  ];
}

export function buildMcpProviderReadinessSnapshot(
  runtime: SkillProviderRuntimeSnapshot,
): RuntimeReadinessSnapshot {
  const transport = typeof runtime.metadata.transport === 'string'
    ? runtime.metadata.transport
    : 'unknown';
  const readiness = mapProviderStateToResourceState(runtime.state);
  const resources: RuntimeResourceSnapshot[] = [{
    resource_id: `mcp.${runtime.provider.id}.server`,
    resource_kind: 'mcp_server',
    desired_state: 'ready',
    actual_state: readiness,
    readiness,
    summary: runtime.summary,
    recovery_actions: runtime.recovery_actions ?? [],
  }];

  return {
    runtime_id: `mcp.${runtime.provider.id}`,
    owner: 'extension',
    phase: 'capability_plane',
    state: mapProviderStateToRuntimeState(runtime.state),
    blocking: false,
    summary: runtime.summary,
    reconciler: {
      desired: 'mcp-provider-ready',
      actual: `${runtime.state}:${transport}`,
      readiness,
      resources,
    },
  };
}

function buildMcpAggregateReadinessSnapshot(
  snapshots: readonly RuntimeReadinessSnapshot[],
): RuntimeReadinessSnapshot {
  if (snapshots.length === 0) {
    return {
      runtime_id: 'mcp.host',
      owner: 'extension',
      phase: 'capability_plane',
      state: 'ready',
      blocking: false,
      summary: '未配置启用的 MCP Server。',
      reconciler: {
        desired: 'mcp-capability-plane-ready',
        actual: 'no-enabled-mcp-servers',
        readiness: 'ready',
        resources: [],
      },
    };
  }

  const resources: RuntimeResourceSnapshot[] = snapshots.map((snapshot) => ({
    resource_id: snapshot.runtime_id,
    resource_kind: 'mcp_provider',
    desired_state: 'ready',
    actual_state: snapshot.reconciler?.readiness ?? mapRuntimeStateToResourceState(snapshot.state),
    readiness: snapshot.reconciler?.readiness ?? mapRuntimeStateToResourceState(snapshot.state),
    summary: snapshot.summary,
    recovery_actions: snapshot.reconciler?.resources.flatMap((resource) => resource.recovery_actions ?? []).slice(0, 4),
  }));
  const readiness = strongestRuntimeResourceState(resources);

  return {
    runtime_id: 'mcp.host',
    owner: 'extension',
    phase: 'capability_plane',
    state: mapResourceStateToRuntimeState(readiness),
    blocking: false,
    summary: readiness === 'ready'
      ? 'MCP provider 平面已就绪。'
      : `MCP provider 平面存在待收口项：${resources.map((resource) => `${resource.resource_id}=${resource.readiness}`).join(', ')}`,
    reconciler: {
      desired: 'mcp-capability-plane-ready',
      actual: resources.map((resource) => `${resource.resource_id}=${resource.readiness}`).join(','),
      readiness,
      resources,
    },
  };
}

function mapProviderStateToRuntimeState(
  state: SkillProviderRuntimeSnapshot['state'],
): RuntimeReadinessSnapshot['state'] {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'connecting':
    case 'contract_only':
      return 'starting';
    case 'degraded':
    case 'unavailable':
      return 'degraded';
    case 'stopped':
    default:
      return 'stopped';
  }
}

function mapProviderStateToResourceState(
  state: SkillProviderRuntimeSnapshot['state'],
): RuntimeResourceSnapshot['readiness'] {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'connecting':
    case 'contract_only':
      return 'pending';
    case 'degraded':
    case 'unavailable':
      return 'degraded';
    case 'stopped':
    default:
      return 'unknown';
  }
}

function mapRuntimeStateToResourceState(
  state: RuntimeReadinessSnapshot['state'],
): RuntimeResourceSnapshot['readiness'] {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'starting':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'degraded':
      return 'degraded';
    case 'stopped':
    default:
      return 'unknown';
  }
}

function mapResourceStateToRuntimeState(
  state: RuntimeResourceSnapshot['readiness'],
): RuntimeReadinessSnapshot['state'] {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'pending':
      return 'starting';
    case 'failed':
      return 'failed';
    case 'degraded':
    case 'missing':
      return 'degraded';
    case 'unknown':
    default:
      return 'stopped';
  }
}
