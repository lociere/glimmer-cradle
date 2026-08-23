import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkillInvocationGateway } from '../../src/application/skill-plane/skill-invocation-gateway';
import { SkillRegistry } from '../../src/application/skill-plane/skill-registry';
import { SkillPolicyEngine } from '../../src/application/skill-plane/skill-policy-engine';
import { McpServerSkillProvider } from '../../src/adapters/skill-plane/mcp-server/mcp-server-skill-provider';
import { RuntimeReadinessProjectionMapper } from '../../src/application/projection/runtime-readiness-projection';
import type { KernelObservabilityPort } from '../../src/ports/observability.port';

const observability: KernelObservabilityPort = {
  logger: () => ({ debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, critical: () => undefined }),
  createTraceContext: (traceId) => ({ trace_id: traceId ?? 'trace-test' }),
  currentTraceId: () => undefined,
  withTrace: async (_traceId, operation) => operation(),
  span: async (_name, operation) => operation({ setAttribute: () => undefined, setStatus: () => undefined }),
  histogram: () => undefined,
  counter: () => undefined,
  start: () => undefined,
  stop: () => undefined,
  close: async () => undefined,
};

describe('McpServerSkillProvider', () => {
  it('把 stdio MCP 的 tool、resource、prompt 投影为可调用 Skill，并在停止时回收', async () => {
    const registry = new SkillRegistry();
    const provider = new McpServerSkillProvider(new RuntimeReadinessProjectionMapper(), () => ({
      mcp_servers: [
        {
          id: 'fixture',
          enabled: true,
          transport: 'stdio',
          command: process.execPath,
          args: [path.resolve(__dirname, '../fixtures/mcp-stdio-fixture.mjs')],
          env: {},
          capability_prefix: 'fixture',
          timeout_ms: 5_000,
        },
      ],
    }));

    try {
      provider.start(registry);
      await provider.waitForPendingConnections();

      const skill = registry.findById('mcp.fixture')?.skill;
      expect(skill).toBeDefined();
      expect(skill?.metadata?.runtime_status).toBe('ready');
      expect(provider.getReadinessSnapshots().find((snapshot) => snapshot.runtime_id === 'mcp.fixture'))
        .toMatchObject({
          state: 'ready',
          reconciler: {
            desired: 'mcp-provider-ready',
            readiness: 'ready',
          },
        });
      expect(skill?.tools.map((tool) => tool.name)).toContain('echo');
      expect(skill?.resources?.map((resource) => resource.id)).toContain('selrena-test://profile');
      expect(skill?.prompts?.map((prompt) => prompt.id)).toContain('greet');

      const gateway = new SkillInvocationGateway(
        registry,
        new SkillPolicyEngine(),
        { record: () => undefined },
        observability,
        { record: () => undefined },
      );
      const toolResult = await gateway.invoke({
        skillId: 'mcp.fixture',
        toolName: 'echo',
        args: { text: '月见' },
      });
      expect(toolResult).toMatchObject({ content: [{ type: 'text', text: '月见' }] });

      const resourceResult = await gateway.readResource({
        skillId: 'mcp.fixture',
        resourceId: 'selrena-test://profile',
      });
      expect(resourceResult).toMatchObject({
        contents: [{ uri: 'selrena-test://profile', text: 'Selrena MCP fixture' }],
      });

      const promptResult = await gateway.renderPrompt({
        skillId: 'mcp.fixture',
        promptId: 'greet',
        args: { name: '月见' },
      });
      expect(promptResult).toMatchObject({
        messages: [{ role: 'user', content: { type: 'text', text: '你好，月见' } }],
      });
    } finally {
      await provider.stop(registry);
    }

    expect(registry.findById('mcp.fixture')).toBeUndefined();
  });
});
