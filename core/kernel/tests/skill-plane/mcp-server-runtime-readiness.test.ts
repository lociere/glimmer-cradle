import { describe, expect, it } from 'vitest';
import type { SkillProviderRuntimeSnapshot } from '../../src/application/skill-plane/types';
import { buildMcpRuntimeReadinessSnapshots } from '../../src/application/skill-plane/providers/mcp-server/mcp-server-runtime-readiness';

describe('mcp-server-runtime-readiness', () => {
  it('returns a ready aggregate when no MCP provider is enabled', () => {
    const snapshots = buildMcpRuntimeReadinessSnapshots([]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      runtime_id: 'mcp.host',
      owner: 'extension',
      phase: 'capability_plane',
      state: 'ready',
      blocking: false,
      reconciler: {
        desired: 'mcp-capability-plane-ready',
        actual: 'no-enabled-mcp-servers',
        readiness: 'ready',
        resources: [],
      },
    });
  });

  it('folds provider runtimes into aggregate and per-server reconciler snapshots', () => {
    const snapshots = buildMcpRuntimeReadinessSnapshots([
      createProviderRuntime({
        provider: { kind: 'mcp_server', id: 'workspace' },
        display_name: 'Workspace MCP',
        state: 'ready',
        summary: 'Workspace MCP 已连接。',
        tool_count: 2,
        resource_count: 1,
        prompt_count: 1,
        metadata: { transport: 'stdio' },
      }),
      createProviderRuntime({
        provider: { kind: 'mcp_server', id: 'browser' },
        display_name: 'Browser MCP',
        state: 'unavailable',
        summary: 'Browser MCP 当前不可用。',
        error: 'connection refused',
        recovery_actions: ['检查 command 配置'],
        metadata: { transport: 'http' },
      }),
    ]);

    expect(snapshots[0]).toMatchObject({
      runtime_id: 'mcp.host',
      state: 'degraded',
      reconciler: {
        desired: 'mcp-capability-plane-ready',
        readiness: 'degraded',
      },
    });
    expect(snapshots.find((snapshot) => snapshot.runtime_id === 'mcp.workspace')).toMatchObject({
      state: 'ready',
      reconciler: {
        desired: 'mcp-provider-ready',
        actual: 'ready:stdio',
        readiness: 'ready',
      },
    });
    expect(snapshots.find((snapshot) => snapshot.runtime_id === 'mcp.browser')).toMatchObject({
      state: 'degraded',
      reconciler: {
        desired: 'mcp-provider-ready',
        actual: 'unavailable:http',
        readiness: 'degraded',
        resources: [
          expect.objectContaining({
            resource_id: 'mcp.browser.server',
            recovery_actions: ['检查 command 配置'],
          }),
        ],
      },
    });
  });
});

function createProviderRuntime(
  overrides: Partial<SkillProviderRuntimeSnapshot>,
): SkillProviderRuntimeSnapshot {
  return {
    provider: { kind: 'mcp_server', id: 'demo' },
    display_name: 'Demo MCP',
    state: 'connecting',
    summary: 'connecting',
    skill_count: 1,
    tool_count: 0,
    resource_count: 0,
    prompt_count: 0,
    recovery_actions: [],
    metadata: {},
    updated_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}
