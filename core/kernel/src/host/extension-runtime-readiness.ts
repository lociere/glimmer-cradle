import type { ExtensionRuntimeProjection } from '@glimmer-cradle/protocol';
import {
  strongestRuntimeReadinessState,
  type RuntimeReadinessSnapshot,
  type RuntimeReadinessState,
} from '../foundation/runtime-readiness';
import {
  strongestRuntimeResourceState,
  type RuntimeResourceSnapshot,
  type RuntimeResourceState,
} from '../foundation/runtime-reconciler';

export function buildExtensionRuntimeReadinessSnapshots(
  projections: readonly ExtensionRuntimeProjection[],
): RuntimeReadinessSnapshot[] {
  const extensionSnapshots = projections
    .map((projection) => buildExtensionRuntimeReadinessSnapshot(projection))
    .sort((left, right) => left.runtime_id.localeCompare(right.runtime_id));

  return [
    buildExtensionHostAggregateSnapshot(extensionSnapshots),
    ...extensionSnapshots,
  ];
}

export function buildExtensionRuntimeReadinessSnapshot(
  projection: ExtensionRuntimeProjection,
): RuntimeReadinessSnapshot {
  const resources = projection.capability_graph.nodes.map((node) => toRuntimeResourceSnapshot(node));
  const reconcilerReadiness = strongestRuntimeResourceState(resources);
  const state = resolveExtensionRuntimeReadinessState(projection, reconcilerReadiness);
  const detailsRef = firstDetailRef(projection);

  return {
    runtime_id: `extension.${projection.extension_id}`,
    owner: 'extension',
    phase: 'capability_plane',
    state,
    blocking: false,
    summary: resolveExtensionRuntimeSummary(projection, state),
    ...(detailsRef ? { details_ref: detailsRef } : {}),
    reconciler: {
      desired: 'extension-runtime-ready',
      actual: extensionLifecycleActual(projection.lifecycle, state),
      readiness: reconcilerReadiness,
      resources,
    },
  };
}

function buildExtensionHostAggregateSnapshot(
  snapshots: readonly RuntimeReadinessSnapshot[],
): RuntimeReadinessSnapshot {
  if (snapshots.length === 0) {
    return {
      runtime_id: 'extension.host',
      owner: 'extension',
      phase: 'capability_plane',
      state: 'ready',
      blocking: false,
      summary: 'Extension Host 已就绪，当前无启用扩展。',
      reconciler: {
        desired: 'extension-host-ready',
        actual: 'no-enabled-extensions',
        readiness: 'ready',
        resources: [],
      },
    };
  }

  const resources = snapshots.map((snapshot): RuntimeResourceSnapshot => ({
    resource_id: snapshot.runtime_id,
    resource_kind: 'extension-runtime',
    desired_state: 'ready',
    actual_state: runtimeReadinessToResourceState(snapshot.state),
    readiness: runtimeReadinessToResourceState(snapshot.state),
    summary: snapshot.summary,
    recovery_actions: snapshot.reconciler?.resources.flatMap((resource) => resource.recovery_actions ?? []).slice(0, 4),
  }));
  const aggregateState = strongestRuntimeReadinessState([...snapshots]) ?? 'ready';
  const readyCount = snapshots.filter((snapshot) => snapshot.state === 'ready').length;
  const degradedCount = snapshots.filter((snapshot) => snapshot.state === 'degraded').length;
  const failedCount = snapshots.filter((snapshot) => snapshot.state === 'failed').length;
  const startingCount = snapshots.filter((snapshot) => snapshot.state === 'starting').length;
  const stoppedCount = snapshots.filter((snapshot) => snapshot.state === 'stopped').length;

  return {
    runtime_id: 'extension.host',
    owner: 'extension',
    phase: 'capability_plane',
    state: aggregateState,
    blocking: false,
    summary: `Extension Host 已接入 ${snapshots.length} 个扩展：ready ${readyCount} / starting ${startingCount} / degraded ${degradedCount} / failed ${failedCount} / stopped ${stoppedCount}`,
    reconciler: {
      desired: 'extension-host-ready',
      actual: `extensions:${aggregateState}`,
      readiness: strongestRuntimeResourceState(resources),
      resources,
    },
  };
}

function toRuntimeResourceSnapshot(
  node: ExtensionRuntimeProjection['capability_graph']['nodes'][number],
): RuntimeResourceSnapshot {
  const desiredState: RuntimeResourceState = 'ready';
  const actualState = capabilityNodeStateToResourceState(node.state, node.required === true);
  return {
    resource_id: node.id,
    resource_kind: node.kind,
    desired_state: desiredState,
    actual_state: actualState,
    readiness: actualState,
    summary: node.summary,
    recovery_actions: readRecoveryActions(node),
  };
}

function resolveExtensionRuntimeReadinessState(
  projection: ExtensionRuntimeProjection,
  reconcilerReadiness: RuntimeResourceState,
): RuntimeReadinessState {
  switch (projection.lifecycle) {
    case 'failed':
      return 'failed';
    case 'degraded':
      return 'degraded';
    case 'stopped':
      return 'stopped';
    case 'discovered':
    case 'loaded':
    case 'starting':
    case 'stopping':
      return 'starting';
    case 'running':
      if (reconcilerReadiness === 'failed' || reconcilerReadiness === 'missing') return 'failed';
      if (reconcilerReadiness === 'degraded' || reconcilerReadiness === 'unknown') return 'degraded';
      if (reconcilerReadiness === 'pending') return 'starting';
      return 'ready';
    default:
      return 'starting';
  }
}

function resolveExtensionRuntimeSummary(
  projection: ExtensionRuntimeProjection,
  state: RuntimeReadinessState,
): string {
  const explicit = projection.diagnostics.last_error?.trim() || projection.summary?.trim();
  if (state === 'ready') {
    return explicit || `扩展 ${projection.extension_id} 已就绪。`;
  }
  if (state === 'failed') {
    return explicit || `扩展 ${projection.extension_id} 当前不可用。`;
  }
  if (state === 'degraded') {
    return explicit || `扩展 ${projection.extension_id} 处于降级状态。`;
  }
  if (state === 'stopped') {
    return explicit || `扩展 ${projection.extension_id} 已停止。`;
  }
  return explicit || `扩展 ${projection.extension_id} 正在准备运行时。`;
}

function extensionLifecycleActual(
  lifecycle: ExtensionRuntimeProjection['lifecycle'],
  state: RuntimeReadinessState,
): string {
  return `${lifecycle}:${state}`;
}

function runtimeReadinessToResourceState(state: RuntimeReadinessState): RuntimeResourceState {
  switch (state) {
    case 'ready':
      return 'ready';
    case 'starting':
      return 'pending';
    case 'degraded':
      return 'degraded';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'unknown';
    default:
      return 'unknown';
  }
}

function capabilityNodeStateToResourceState(
  state: ExtensionRuntimeProjection['capability_graph']['nodes'][number]['state'],
  required: boolean,
): RuntimeResourceState {
  switch (state) {
    case 'ready':
    case 'available':
      return 'ready';
    case 'degraded':
      return 'degraded';
    case 'failed':
      return 'failed';
    case 'unavailable':
      return required ? 'missing' : 'degraded';
    case 'starting':
    case 'preparing':
    case 'declared':
    case 'live':
      return 'pending';
    case 'disabled':
    case 'stopped':
    case 'unsupported':
    default:
      return 'unknown';
  }
}

function readRecoveryActions(
  node: ExtensionRuntimeProjection['capability_graph']['nodes'][number],
): readonly string[] | undefined {
  const value = node.metadata?.recovery_actions;
  if (!Array.isArray(value)) {
    return undefined;
  }
  const actions = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return actions.length > 0 ? actions : undefined;
}

function firstDetailRef(projection: ExtensionRuntimeProjection): string | undefined {
  if (projection.diagnostics.log_locations.length > 0) {
    return projection.diagnostics.log_locations[0];
  }
  for (const entry of projection.diagnostics.entries) {
    if (entry.log_locations.length > 0) {
      return entry.log_locations[0];
    }
  }
  return undefined;
}
