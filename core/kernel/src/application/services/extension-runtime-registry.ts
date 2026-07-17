import {
  BuiltInContributionPoint,
  BuiltInContributionPointDefinitions,
  getExtensionContributions,
  type ActionIntentSnapshot,
  type ActionIntentState,
  type CapabilityGraphEdge,
  type CapabilityGraphNode,
  type CapabilityNodeState,
  type ContributionPointDefinitionSnapshot,
  type DiagnosticsEntry,
  type DiagnosticsSnapshot,
  type ExtensionRuntimeProjection,
  type ReadinessGateSnapshot,
  type ContributionDeclaration,
  type ContributionPointDefinition,
  type ExtensionCommandContribution,
  type ExtensionManifest,
  type ExtensionSkillContribution,
  type ManagedResourceContribution,
} from '@glimmer-cradle/protocol';
import type { ExtensionCapabilityGraphReport } from '../../foundation/ports';
import { DEFAULT_DESKTOP_SKILL_AVAILABILITY, isContributionAvailable } from '../skill-plane/availability';
import type { SkillAvailabilityContext } from '../skill-plane/types';

type ExtensionLifecycle = ExtensionRuntimeProjection['lifecycle'];

type ExtensionManifestRuntimeInput = Pick<
  ExtensionManifest,
  'id' | 'name' | 'version' | 'description' | 'tags' | 'contributionPoints' | 'contributes' | 'permissions'
>;

export class ExtensionRuntimeRegistry {
  private readonly projections = new Map<string, ExtensionRuntimeProjection>();

  public constructor(
    private readonly availabilityContext: SkillAvailabilityContext = DEFAULT_DESKTOP_SKILL_AVAILABILITY,
  ) {}

  public registerManifest(manifest: ExtensionManifestRuntimeInput): ExtensionRuntimeProjection {
    const now = new Date().toISOString();
    const contributionPoints = resolveContributionPoints(manifest);
    const graph = buildCapabilityGraph(manifest, contributionPoints, now, this.availabilityContext);
    const projection: ExtensionRuntimeProjection = recalculateProjection({
      schema: 'glimmer-cradle.extension.runtime-projection',
      extension_id: manifest.id,
      display_name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      permissions: [...manifest.permissions],
      tags: [...manifest.tags],
      lifecycle: 'loaded',
      summary: lifecycleSummary('loaded'),
      contribution_points: contributionPoints,
      capability_graph: graph,
      actions: buildActionIntents(manifest, graph.nodes, 'loaded', contributionPoints),
      diagnostics: {
        summary: '尚未收到运行诊断。',
        entries: [],
        log_locations: [],
        recovery_actions: [],
      },
      updated_at: now,
    });

    this.projections.set(manifest.id, projection);
    return projection;
  }

  public updateLifecycle(
    extensionId: string,
    lifecycle: ExtensionLifecycle,
    summary?: string,
    error?: string,
  ): ExtensionRuntimeProjection | undefined {
    const current = this.projections.get(extensionId);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const next = recalculateProjection({
      ...current,
      lifecycle,
      summary: summary ?? lifecycleSummary(lifecycle),
      diagnostics: {
        ...current.diagnostics,
        summary: error ?? current.diagnostics.summary,
        last_error: error ?? current.diagnostics.last_error,
        entries: error
          ? upsertDiagnosticEntry(current.diagnostics.entries, {
            id: 'extension.lifecycle.error',
            severity: 'error',
            summary: error,
            log_locations: [],
            recovery_actions: [],
            metadata: {},
          })
          : current.diagnostics.entries,
      },
      updated_at: now,
    });
    this.projections.set(extensionId, next);
    return next;
  }

  public mergeCapabilityGraph(
    extensionId: string,
    report: ExtensionCapabilityGraphReport,
  ): ExtensionRuntimeProjection | undefined {
    const current = this.projections.get(extensionId);
    if (!current) return undefined;
    const now = new Date().toISOString();
    const nodes = mergeById(current.capability_graph.nodes, report.nodes ?? []);
    const edges = mergeEdges(current.capability_graph.edges, report.edges ?? []);
    const actions = mergeById(current.actions, report.actions ?? []);
    const diagnostics = report.diagnostics ?? current.diagnostics;
    const next = recalculateProjection({
      ...current,
      capability_graph: { nodes, edges },
      actions,
      diagnostics,
      updated_at: now,
    });
    this.projections.set(extensionId, next);
    return next;
  }

  public updateDiagnostics(
    extensionId: string,
    diagnostics: ExtensionRuntimeProjection['diagnostics'],
  ): ExtensionRuntimeProjection | undefined {
    const current = this.projections.get(extensionId);
    if (!current) return undefined;
    const next: ExtensionRuntimeProjection = {
      ...current,
      diagnostics,
      updated_at: new Date().toISOString(),
    };
    this.projections.set(extensionId, next);
    return next;
  }

  public unregister(extensionId: string): void {
    this.projections.delete(extensionId);
  }

  public list(): ExtensionRuntimeProjection[] {
    return Array.from(this.projections.values())
      .sort((left, right) => left.extension_id.localeCompare(right.extension_id));
  }

  public get(extensionId: string): ExtensionRuntimeProjection | undefined {
    return this.projections.get(extensionId);
  }
}

function resolveContributionPoints(
  manifest: ExtensionManifestRuntimeInput,
): ContributionPointDefinitionSnapshot[] {
  const definitions = new Map<string, ContributionPointDefinitionSnapshot>();
  for (const definition of BuiltInContributionPointDefinitions) {
    definitions.set(definition.id, toDefinitionSnapshot(definition, 'registered'));
  }
  for (const definition of manifest.contributionPoints) {
    definitions.set(definition.id, toDefinitionSnapshot(definition, 'registered'));
  }
  for (const pointId of Object.keys(manifest.contributes)) {
    if (!definitions.has(pointId)) {
      definitions.set(pointId, {
        id: pointId,
        title: pointId,
        description: '未安装或未启用对应 contribution point definition，Host 只保留声明并标记为 unsupported。',
        owner: 'extension',
        state: 'unsupported',
        node_kind: 'unsupported',
        required_permissions: [],
        metadata: {},
      });
    }
  }
  return Array.from(definitions.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function toDefinitionSnapshot(
  definition: ContributionPointDefinition,
  state: ContributionPointDefinitionSnapshot['state'],
): ContributionPointDefinitionSnapshot {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    owner: normalizeOwner(definition.owner),
    state,
    node_kind: definition.nodeKind,
    action_kind: definition.actionKind,
    required_permissions: [...definition.requiredPermissions],
    metadata: definition.schema ? { schema: definition.schema } : {},
  };
}

function buildCapabilityGraph(
  manifest: ExtensionManifestRuntimeInput,
  contributionPoints: ContributionPointDefinitionSnapshot[],
  now: string,
  availabilityContext: SkillAvailabilityContext,
): ExtensionRuntimeProjection['capability_graph'] {
  const definitions = new Map(contributionPoints.map((definition) => [definition.id, definition]));
  const nodes: CapabilityGraphNode[] = [];
  const edges: CapabilityGraphEdge[] = [];

  for (const [pointId, declarations] of Object.entries(manifest.contributes)) {
    const normalizedDeclarations = getExtensionContributions<ContributionDeclaration>(manifest, pointId);
    const definition = definitions.get(pointId);
    for (const [index, declaration] of normalizedDeclarations.entries()) {
      const node = toCapabilityGraphNode(
        manifest.id,
        pointId,
        definition,
        declaration,
        now,
        index,
        availabilityContext,
      );
      nodes.push(node);
      for (const dependency of normalizeDependencies(pointId, declaration)) {
        edges.push({
          from: node.id,
          to: dependency.nodeId,
          relation: dependency.relation,
          required_state: dependency.requiredState,
        });
      }
    }
  }

  return {
    nodes: mergeById([], nodes),
    edges: mergeEdges([], edges),
  };
}

function toCapabilityGraphNode(
  extensionId: string,
  pointId: string,
  definition: ContributionPointDefinitionSnapshot | undefined,
  declaration: ContributionDeclaration,
  now: string,
  declarationIndex: number,
  availabilityContext: SkillAvailabilityContext,
): CapabilityGraphNode {
  const unavailableInProduct = !isContributionAvailable(declaration.requirements, availabilityContext);
  const isUnsupported = !definition || definition.state !== 'registered' || unavailableInProduct;
  const id = readDeclarationId(pointId, declaration, declarationIndex);
  const title = readString(declaration, 'title')
    || readString(declaration, 'name')
    || readString(declaration, 'displayName')
    || readString(declaration, 'command')
    || readString(declaration, 'key')
    || id;
  const description = readString(declaration, 'description');
  const kind = pointNodeKind(pointId, definition, declaration);
  return {
    id,
    contribution_point: pointId,
    kind,
    title,
    description,
    state: isUnsupported ? 'unsupported' : 'declared',
    owner: 'extension',
    owner_id: extensionId,
    audience: resolveAudience(pointId, declaration),
    required: readBoolean(declaration, 'required', defaultRequiredForPoint(pointId)),
    summary: isUnsupported
      ? unavailableInProduct
        ? `能力不支持当前产品 ${availabilityContext.productId}，声明已保留但不会执行或进入人物目录。`
        : `未知 contribution point：${pointId}。声明已保留，但不会执行或进入 Cognition。`
      : description || '能力节点已声明，等待 Host 生命周期与依赖关系确认。',
    permissions: readStringArray(declaration.permissions),
    readiness_gates: normalizeReadinessGates(declaration, now),
    diagnostic_refs: [],
    metadata: sanitizeDeclarationMetadata(declaration),
    updated_at: now,
  };
}

function buildActionIntents(
  manifest: ExtensionManifestRuntimeInput,
  nodes: CapabilityGraphNode[],
  lifecycle: ExtensionLifecycle,
  contributionPoints: ContributionPointDefinitionSnapshot[],
): ActionIntentSnapshot[] {
  const definitions = new Map(contributionPoints.map((definition) => [definition.id, definition]));
  const actions: ActionIntentSnapshot[] = [];
  const commands = getExtensionContributions<ExtensionCommandContribution>(
    manifest,
    BuiltInContributionPoint.command,
  );
  for (const command of commands) {
    const nodeId = readDeclarationId(BuiltInContributionPoint.command, command);
    const node = nodes.find((item) => item.id === nodeId);
    const definition = definitions.get(BuiltInContributionPoint.command);
    const state = resolveActionState(lifecycle, node, definition);
    actions.push({
      id: command.command,
      label: command.title,
      contribution_point: BuiltInContributionPoint.command,
      action_kind: definition?.action_kind ?? command.actionKind ?? 'command',
      target_node_id: nodeId,
      audience: resolveAudience(BuiltInContributionPoint.command, command),
      state,
      disabled_reason: state === 'enabled' ? undefined : disabledReasonForAction(lifecycle, node, definition),
      permissions: readStringArray(command.permissions),
      confirmation_required: false,
      metadata: {
        command: command.command,
        category: command.category,
      },
    });
  }
  return actions;
}

function resolveAudience(
  pointId: string,
  declaration: Record<string, unknown>,
): CapabilityGraphNode['audience'] {
  const value = readString(declaration, 'audience');
  if (isCapabilityAudience(value)) return value;
  if (pointId === BuiltInContributionPoint.skill) return 'character';
  if (pointId === BuiltInContributionPoint.command || pointId === BuiltInContributionPoint.managementSurface) {
    return 'user';
  }
  if (pointId === BuiltInContributionPoint.protocolBridge) return 'adapter';
  if (pointId === BuiltInContributionPoint.view) return 'renderer';
  if (pointId === BuiltInContributionPoint.capability || pointId === BuiltInContributionPoint.managedResource) {
    return 'host';
  }
  return 'extension';
}

function isCapabilityAudience(value: string): value is CapabilityGraphNode['audience'] {
  return value === 'character'
    || value === 'user'
    || value === 'host'
    || value === 'renderer'
    || value === 'extension'
    || value === 'adapter';
}

function recalculateProjection(projection: ExtensionRuntimeProjection): ExtensionRuntimeProjection {
  const now = new Date().toISOString();
  const graph = projection.capability_graph;
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes.map((node) => {
    const state = resolveNodeState(node, projection.lifecycle, graph.edges, nodeMap);
    return {
      ...node,
      state,
      summary: state === 'unsupported'
        ? node.summary
        : state === 'unavailable'
          ? '依赖节点尚未就绪。'
          : lifecycleNodeSummary(projection.lifecycle, node, state),
      updated_at: now,
    };
  });
  const updatedNodeMap = new Map(nodes.map((node) => [node.id, node]));
  const actions = projection.actions.map((action) => {
    const node = updatedNodeMap.get(action.target_node_id);
    const state = resolveActionStateFromNode(projection.lifecycle, node, action.state);
    return {
      ...action,
      state,
      disabled_reason: state === 'enabled'
        ? undefined
        : disabledReasonForAction(projection.lifecycle, node),
    };
  });
  return {
    ...projection,
    capability_graph: {
      nodes,
      edges: graph.edges,
    },
    actions,
  };
}

function resolveNodeState(
  node: CapabilityGraphNode,
  lifecycle: ExtensionLifecycle,
  edges: CapabilityGraphEdge[],
  nodeMap: Map<string, CapabilityGraphNode>,
): CapabilityNodeState {
  if (node.state === 'unsupported') return 'unsupported';
  if (lifecycle === 'failed') return node.required ? 'failed' : 'degraded';
  if (lifecycle === 'stopped' || lifecycle === 'loaded' || lifecycle === 'discovered') {
    return isResourceLike(node) ? node.state : 'disabled';
  }
  if (lifecycle === 'starting' || lifecycle === 'stopping') {
    return isResourceLike(node) ? node.state : 'starting';
  }
  if (isResourceLike(node)) {
    return node.state === 'declared' ? 'declared' : node.state;
  }

  const dependencies = edges.filter((edge) => edge.from === node.id);
  for (const edge of dependencies) {
    const target = nodeMap.get(edge.to);
    const required = edge.required_state ?? 'ready';
    if (!target || !nodeStateSatisfies(target.state, required)) {
      return 'unavailable';
    }
  }
  return node.kind === 'setting' || node.kind === 'management_surface' ? 'ready' : 'available';
}

function resolveActionState(
  lifecycle: ExtensionLifecycle,
  node: CapabilityGraphNode | undefined,
  definition?: ContributionPointDefinitionSnapshot,
): ActionIntentState {
  if (!definition || definition.state !== 'registered') return 'unsupported';
  return resolveActionStateFromNode(lifecycle, node);
}

function resolveActionStateFromNode(
  lifecycle: ExtensionLifecycle,
  node: CapabilityGraphNode | undefined,
  current: ActionIntentState = 'disabled',
): ActionIntentState {
  if (current === 'hidden' || current === 'unsupported') return current;
  if (lifecycle !== 'running') return 'disabled';
  if (!node || node.state === 'unsupported') return 'unsupported';
  if (nodeStateSatisfies(node.state, 'available') || nodeStateSatisfies(node.state, 'ready')) {
    return 'enabled';
  }
  return 'disabled';
}

function disabledReasonForAction(
  lifecycle: ExtensionLifecycle,
  node?: CapabilityGraphNode,
  definition?: ContributionPointDefinitionSnapshot,
): string {
  if (definition && definition.state !== 'registered') {
    return `Contribution point ${definition.id} 未注册为可执行定义。`;
  }
  if (lifecycle !== 'running') return lifecycleSummary(lifecycle);
  if (!node) return 'Host 尚未收到目标能力节点。';
  if (node.state === 'unsupported') return node.summary;
  return `目标节点 ${node.id} 当前状态为 ${node.state}。`;
}

function lifecycleSummary(lifecycle: ExtensionLifecycle): string {
  switch (lifecycle) {
    case 'discovered':
      return '扩展已发现。';
    case 'loaded':
      return '扩展已加载，等待启动。';
    case 'starting':
      return '扩展正在启动。';
    case 'running':
      return '扩展 Host 生命周期已运行。';
    case 'stopping':
      return '扩展正在停止。';
    case 'stopped':
      return '扩展已停止。';
    case 'degraded':
      return '扩展处于降级状态。';
    case 'failed':
      return '扩展运行失败。';
    default:
      return '扩展状态未知。';
  }
}

function lifecycleNodeSummary(
  lifecycle: ExtensionLifecycle,
  node: CapabilityGraphNode,
  state: CapabilityNodeState,
): string {
  if (state === node.state && node.summary) return node.summary;
  if (lifecycle !== 'running') return lifecycleSummary(lifecycle);
  if (state === 'available' || state === 'ready') return `${node.title} 已可用。`;
  return node.summary;
}

function readDeclarationId(
  pointId: string,
  declaration: Record<string, unknown>,
  declarationIndex = 0,
): string {
  const explicit = readString(declaration, 'nodeId')
    || readString(declaration, 'id')
    || readString(declaration, 'command')
    || readString(declaration, 'key')
    || readString(declaration, 'name');
  return explicit || `${pointId}:${declarationIndex}`;
}

function defaultRequiredForPoint(pointId: string): boolean {
  return pointId === BuiltInContributionPoint.managedResource
    || pointId === BuiltInContributionPoint.protocolBridge;
}

function pointNodeKind(
  pointId: string,
  definition: ContributionPointDefinitionSnapshot | undefined,
  declaration: Record<string, unknown>,
): string {
  if (pointId === BuiltInContributionPoint.managedResource) {
    return readString(declaration, 'kind') || 'managed_resource';
  }
  if (pointId === BuiltInContributionPoint.protocolBridge) {
    return readString(declaration, 'kind') || 'protocol_bridge';
  }
  return definition?.node_kind ?? pointId;
}

function normalizeDependencies(
  pointId: string,
  declaration: ContributionDeclaration,
): Array<{ nodeId: string; requiredState?: string; relation: string }> {
  const result = declaration.dependsOn.map((dependency) => ({
    nodeId: dependency.nodeId,
    requiredState: dependency.requiredState,
    relation: dependency.relation,
  }));
  if (pointId === BuiltInContributionPoint.command) {
    const command = declaration as ExtensionCommandContribution;
    for (const precondition of command.preconditions ?? []) {
      result.push({
        nodeId: precondition.nodeId,
        requiredState: precondition.requiredState,
        relation: precondition.relation,
      });
    }
  }
  if (pointId === BuiltInContributionPoint.capability) {
    const resourceIds = readStringArray((declaration as Record<string, unknown>).resourceIds);
    for (const resourceId of resourceIds) {
      result.push({ nodeId: resourceId, requiredState: 'ready', relation: 'depends_on' });
    }
  }
  if (pointId === BuiltInContributionPoint.managementSurface) {
    const resourceIds = readStringArray((declaration as Record<string, unknown>).resourceIds);
    const capabilityIds = readStringArray((declaration as Record<string, unknown>).capabilityIds);
    for (const resourceId of resourceIds) {
      result.push({ nodeId: resourceId, requiredState: 'ready', relation: 'depends_on' });
    }
    for (const capabilityId of capabilityIds) {
      result.push({ nodeId: capabilityId, requiredState: 'available', relation: 'depends_on' });
    }
  }
  return result;
}

function normalizeReadinessGates(
  declaration: Record<string, unknown>,
  now: string,
): ReadinessGateSnapshot[] {
  const gates = Array.isArray(declaration.readinessGates)
    ? declaration.readinessGates
    : [];
  return gates
    .filter((gate): gate is Record<string, unknown> => Boolean(gate) && typeof gate === 'object' && !Array.isArray(gate))
    .map((gate, index) => ({
      id: readString(gate, 'id') || `${readString(declaration, 'id') || 'gate'}:${index}`,
      kind: readString(gate, 'kind') || 'readiness',
      state: 'declared' as const,
      summary: readString(gate, 'endpoint') ? `等待检查 ${readString(gate, 'endpoint')}` : 'readiness gate 已声明。',
      endpoint: readString(gate, 'endpoint') || undefined,
      checked_at: now,
    }));
}

function sanitizeDeclarationMetadata(declaration: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(declaration)) {
    if (key === 'dependsOn' || key === 'permissions' || key === 'readinessGates') continue;
    if (value !== undefined) metadata[key] = value;
  }
  return metadata;
}

function isResourceLike(node: CapabilityGraphNode): boolean {
  return node.contribution_point === BuiltInContributionPoint.managedResource
    || node.contribution_point === BuiltInContributionPoint.protocolBridge
    || node.kind === 'managedProcess'
    || node.kind === 'localService'
    || node.kind === 'protocolBridge'
    || node.kind === 'managementEndpoint'
    || node.kind === 'package';
}

function nodeStateSatisfies(state: CapabilityNodeState, requiredState: string): boolean {
  if (state === requiredState) return true;
  if (requiredState === 'ready') return state === 'ready' || state === 'available';
  if (requiredState === 'available') return state === 'available' || state === 'ready';
  if (requiredState === 'live') return state === 'live' || state === 'ready' || state === 'available';
  return false;
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    merged.set(item.id, {
      ...merged.get(item.id),
      ...item,
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function mergeEdges(existing: CapabilityGraphEdge[], incoming: CapabilityGraphEdge[]): CapabilityGraphEdge[] {
  const edgeKey = (edge: CapabilityGraphEdge): string => `${edge.from}->${edge.to}:${edge.relation}`;
  const merged = new Map(existing.map((edge) => [edgeKey(edge), edge]));
  for (const edge of incoming) {
    merged.set(edgeKey(edge), { ...merged.get(edgeKey(edge)), ...edge });
  }
  return Array.from(merged.values()).sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)));
}

function upsertDiagnosticEntry(entries: DiagnosticsEntry[], entry: DiagnosticsEntry): DiagnosticsEntry[] {
  return mergeById(entries, [entry]);
}

function normalizeOwner(value: ContributionPointDefinition['owner']): ContributionPointDefinitionSnapshot['owner'] {
  if (value === 'thirdParty') return 'third_party';
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readBoolean(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
