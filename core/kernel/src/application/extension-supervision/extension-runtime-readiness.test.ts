import { describe, expect, it } from 'vitest';
import type { ExtensionRuntimeProjection } from '@glimmer-cradle/protocol';
import {
  buildExtensionRuntimeReadinessSnapshot,
  buildExtensionRuntimeReadinessSnapshots,
} from './extension-runtime-readiness';

describe('extension-runtime-readiness', () => {
  it('returns a ready host aggregate when no extension is enabled', () => {
    const snapshots = buildExtensionRuntimeReadinessSnapshots([]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      runtime_id: 'extension.host',
      owner: 'extension',
      phase: 'capability_plane',
      state: 'ready',
      blocking: false,
    });
    expect(snapshots[0].reconciler).toMatchObject({
      desired: 'extension-host-ready',
      actual: 'no-enabled-extensions',
      readiness: 'ready',
      resources: [],
    });
  });

  it('maps a running extension with ready required resources to ready readiness', () => {
    const snapshot = buildExtensionRuntimeReadinessSnapshot(createProjection({
      extension_id: 'demo-ready',
      lifecycle: 'running',
      capability_graph: {
        nodes: [createNode({
          id: 'demo-ready.process',
          kind: 'localService',
          state: 'ready',
          required: true,
          summary: '进程已就绪',
        })],
        edges: [],
      },
    }));

    expect(snapshot).toMatchObject({
      runtime_id: 'extension.demo-ready',
      owner: 'extension',
      phase: 'capability_plane',
      state: 'ready',
      blocking: false,
    });
    expect(snapshot.reconciler).toMatchObject({
      desired: 'extension-runtime-ready',
      actual: 'running:ready',
      readiness: 'ready',
    });
    expect(snapshot.reconciler?.resources).toEqual([expect.objectContaining({
      resource_id: 'demo-ready.process',
      readiness: 'ready',
    })]);
  });

  it('upgrades required unavailable nodes to failed readiness and keeps detail refs', () => {
    const snapshot = buildExtensionRuntimeReadinessSnapshot(createProjection({
      extension_id: 'demo-missing',
      lifecycle: 'running',
      diagnostics: {
        summary: '缺少依赖',
        last_error: '包资源缺失',
        trace_id: 'trace-demo',
        log_locations: ['data/observability/logs/application/extensions/demo-missing.log'],
        recovery_actions: ['重新安装扩展包'],
        entries: [],
      },
      capability_graph: {
        nodes: [createNode({
          id: 'demo-missing.package',
          kind: 'package',
          state: 'unavailable',
          required: true,
          summary: '包资源缺失',
          metadata: { recovery_actions: ['重新安装扩展包'] },
        })],
        edges: [],
      },
    }));

    expect(snapshot.state).toBe('failed');
    expect(snapshot.summary).toBe('包资源缺失');
    expect(snapshot.details_ref).toBe('data/observability/logs/application/extensions/demo-missing.log');
    expect(snapshot.reconciler).toMatchObject({
      actual: 'running:failed',
      readiness: 'missing',
    });
    expect(snapshot.reconciler?.resources[0]).toMatchObject({
      resource_id: 'demo-missing.package',
      actual_state: 'missing',
      recovery_actions: ['重新安装扩展包'],
    });
  });
});

function createProjection(
  overrides: Partial<ExtensionRuntimeProjection>,
): ExtensionRuntimeProjection {
  return {
    schema: 'glimmer-cradle.extension.runtime-projection',
    extension_id: 'demo-extension',
    display_name: 'Demo Extension',
    version: '1.0.0',
    description: undefined,
    permissions: [],
    tags: [],
    lifecycle: 'loaded',
    summary: 'projection-summary',
    contribution_points: [],
    capability_graph: {
      nodes: [],
      edges: [],
    },
    actions: [],
    diagnostics: {
      summary: 'ok',
      trace_id: undefined,
      last_error: undefined,
      entries: [],
      log_locations: [],
      recovery_actions: [],
    },
    updated_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

function createNode(
  overrides: Partial<ExtensionRuntimeProjection['capability_graph']['nodes'][number]>,
): ExtensionRuntimeProjection['capability_graph']['nodes'][number] {
  return {
    id: 'demo.node',
    contribution_point: 'glimmer.managedResource',
    kind: 'localService',
    title: 'Demo Node',
    state: 'declared',
    owner: 'extension',
    owner_id: 'demo-extension',
    audience: 'host',
    required: true,
    summary: 'declared',
    permissions: [],
    readiness_gates: [],
    diagnostic_refs: [],
    metadata: {},
    updated_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}
