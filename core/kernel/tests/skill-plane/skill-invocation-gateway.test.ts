import { describe, expect, it } from 'vitest';
import {
  SkillInvocationGateway,
  type SkillInvocationAuditRecord,
  type SkillInvocationAuditSink,
} from '../../src/application/skill-plane/skill-invocation-gateway';
import { SkillRegistry } from '../../src/application/skill-plane/skill-registry';

class MemoryAuditSink implements SkillInvocationAuditSink {
  public readonly records: SkillInvocationAuditRecord[] = [];

  public record(record: SkillInvocationAuditRecord): void {
    this.records.push(record);
  }
}

describe('SkillInvocationGateway', () => {
  it('调用成功时记录 provider、policy、trace 与结果摘要', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.audit.success';
    const audit = new MemoryAuditSink();

    registry.registerSkill({
      id: skillId,
      name: '审计成功技能',
      description: '用于验证成功审计',
      provider: { kind: 'core', id: 'test-provider' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{
        name: 'echo',
        description: '回显',
        parameters: { type: 'object' },
        handler: async (args) => args,
      }],
    });

    try {
      const gateway = new SkillInvocationGateway(registry, undefined, audit);
      await expect(gateway.invoke({
        skillId,
        toolName: 'echo',
        args: { text: '月见' },
        traceId: 'trace-skill-success',
      })).resolves.toEqual({ text: '月见' });

      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        trace_id: 'trace-skill-success',
        provider_kind: 'core',
        provider_id: 'test-provider',
        skill_id: skillId,
        target_kind: 'tool',
        target_name: 'echo',
        status: 'succeeded',
        result_type: 'object',
        policy_decision: {
          allowed: true,
          confirmationRequired: false,
        },
      });
    } finally {
      registry.unregisterSkill(skillId);
    }
  });

  it('策略拒绝时记录拒绝原因，即使成功审计未开启', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.audit.denied';
    const audit = new MemoryAuditSink();

    registry.registerSkill({
      id: skillId,
      name: '审计拒绝技能',
      description: '用于验证策略拒绝审计',
      audience: 'character',
      provider: { kind: 'extension', id: 'test-extension' },
      policy: { riskLevel: 'high', confirmationRequired: false, sideEffects: ['network'], audit: false },
      tools: [{
        name: 'dangerous',
        description: '需要确认',
        audience: 'character',
        parameters: { type: 'object' },
        policy: { riskLevel: 'high', confirmationRequired: true, sideEffects: ['network'], audit: false },
        handler: () => ({ ok: true }),
      }],
    });

    try {
      const gateway = new SkillInvocationGateway(registry, undefined, audit);
      await expect(gateway.invoke({
        skillId,
        toolName: 'dangerous',
        args: {},
        traceId: 'trace-skill-denied',
      })).rejects.toThrow('需要用户确认');

      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        trace_id: 'trace-skill-denied',
        provider_kind: 'extension',
        provider_id: 'test-extension',
        skill_id: skillId,
        target_kind: 'tool',
        target_name: 'dangerous',
        status: 'policy_denied',
        policy_decision: {
          allowed: false,
          confirmationRequired: true,
        },
      });
      expect(audit.records[0].error_message).toContain('需要用户确认');
    } finally {
      registry.unregisterSkill(skillId);
    }
  });

  it('拒绝执行非 character audience 的扩展工具', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.user-audience';

    registry.registerSkill({
      id: skillId,
      name: '管理面板技能',
      description: '不允许角色调用',
      audience: 'user',
      provider: { kind: 'extension', id: 'test-extension' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{
        name: 'openPanel',
        description: '打开管理面板',
        audience: 'user',
        parameters: { type: 'object' },
        handler: () => 'opened',
      }],
    });

    try {
      const gateway = new SkillInvocationGateway(registry);
      await expect(gateway.invoke({
        skillId,
        toolName: 'openPanel',
        args: {},
        traceId: 'trace-user-audience',
      })).rejects.toThrow('未暴露给角色使用');
    } finally {
      registry.unregisterSkill(skillId);
    }
  });

  it('拒绝读取或渲染非 character audience 的资源与提示模板', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.resource-prompt-audience';

    registry.registerSkill({
      id: skillId,
      name: '混合资源技能',
      description: '不允许角色读取管理资源',
      audience: 'character',
      provider: { kind: 'extension', id: 'test-extension' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{
        name: 'lookup',
        description: '角色工具',
        audience: 'character',
        parameters: { type: 'object' },
        handler: () => 'ok',
      }],
      resources: [
        {
          id: 'character.resource',
          description: '角色资源',
          audience: 'character',
          read: () => 'visible',
        },
        {
          id: 'host.resource',
          description: 'Host 资源',
          audience: 'host',
          read: () => 'hidden',
        },
      ],
      prompts: [
        {
          id: 'character.prompt',
          description: '角色 Prompt',
          audience: 'character',
          template: 'visible',
        },
        {
          id: 'user.prompt',
          description: '用户 Prompt',
          audience: 'user',
          template: 'hidden',
        },
      ],
    });

    try {
      const gateway = new SkillInvocationGateway(registry);
      await expect(gateway.readResource({
        skillId,
        resourceId: 'character.resource',
        traceId: 'trace-character-resource',
      })).resolves.toBe('visible');
      await expect(gateway.renderPrompt({
        skillId,
        promptId: 'character.prompt',
        traceId: 'trace-character-prompt',
      })).resolves.toBe('visible');

      await expect(gateway.readResource({
        skillId,
        resourceId: 'host.resource',
        traceId: 'trace-host-resource',
      })).rejects.toThrow('未暴露给角色使用');
      await expect(gateway.renderPrompt({
        skillId,
        promptId: 'user.prompt',
        traceId: 'trace-user-prompt',
      })).rejects.toThrow('未暴露给角色使用');
    } finally {
      registry.unregisterSkill(skillId);
    }
  });

  it('需要确认的 skill 在用户确认后才执行 handler', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.confirmation.approved';
    const audit = new MemoryAuditSink();
    const confirmationRequests: unknown[] = [];

    registry.registerSkill({
      id: skillId,
      name: '确认通过技能',
      description: '用于验证确认通过',
      provider: { kind: 'core', id: 'test-provider' },
      policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['system'], audit: true },
      tools: [{
        name: 'run',
        description: '执行',
        parameters: { type: 'object' },
        handler: async (args) => ({ ok: true, args }),
      }],
    });

    try {
      const gateway = new SkillInvocationGateway(registry, undefined, audit, async (request) => {
        confirmationRequests.push(request);
        return true;
      });
      await expect(gateway.invoke({
        skillId,
        toolName: 'run',
        args: { url: 'https://example.com' },
        traceId: 'trace-skill-confirm-approved',
      })).resolves.toEqual({ ok: true, args: { url: 'https://example.com' } });

      expect(confirmationRequests).toEqual([expect.objectContaining({
        traceId: 'trace-skill-confirm-approved',
        skillId,
        targetKind: 'tool',
        targetName: 'run',
        riskLevel: 'medium',
        args: { url: 'https://example.com' },
      })]);
      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        status: 'succeeded',
        policy_decision: {
          allowed: true,
          confirmationRequired: true,
        },
      });
    } finally {
      registry.unregisterSkill(skillId);
    }
  });

  it('需要确认的 skill 被用户拒绝时不执行 handler 并记录拒绝', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.confirmation.rejected';
    const audit = new MemoryAuditSink();
    let executed = false;

    registry.registerSkill({
      id: skillId,
      name: '确认拒绝技能',
      description: '用于验证确认拒绝',
      provider: { kind: 'core', id: 'test-provider' },
      policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['system'], audit: true },
      tools: [{
        name: 'run',
        description: '执行',
        parameters: { type: 'object' },
        handler: () => {
          executed = true;
          return { ok: true };
        },
      }],
    });

    try {
      const gateway = new SkillInvocationGateway(registry, undefined, audit, async () => false);
      await expect(gateway.invoke({
        skillId,
        toolName: 'run',
        args: {},
        traceId: 'trace-skill-confirm-rejected',
      })).rejects.toThrow('用户拒绝执行技能');

      expect(executed).toBe(false);
      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        trace_id: 'trace-skill-confirm-rejected',
        status: 'policy_denied',
        policy_decision: {
          allowed: false,
          confirmationRequired: true,
        },
      });
    } finally {
      registry.unregisterSkill(skillId);
    }
  });

  it('handler 抛错时记录失败并保留原错误', async () => {
    const registry = SkillRegistry.instance;
    const skillId = 'test.gateway.audit.failed';
    const audit = new MemoryAuditSink();

    registry.registerSkill({
      id: skillId,
      name: '审计失败技能',
      description: '用于验证失败审计',
      provider: { kind: 'mcp_server', id: 'test-mcp' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: false },
      tools: [{
        name: 'explode',
        description: '抛错',
        parameters: { type: 'object' },
        handler: () => {
          throw new Error('fixture boom');
        },
      }],
    });

    try {
      const gateway = new SkillInvocationGateway(registry, undefined, audit);
      await expect(gateway.invoke({
        skillId,
        toolName: 'explode',
        args: {},
        traceId: 'trace-skill-failed',
      })).rejects.toThrow('fixture boom');

      expect(audit.records).toHaveLength(1);
      expect(audit.records[0]).toMatchObject({
        trace_id: 'trace-skill-failed',
        provider_kind: 'mcp_server',
        provider_id: 'test-mcp',
        skill_id: skillId,
        target_kind: 'tool',
        target_name: 'explode',
        status: 'failed',
        error_message: 'fixture boom',
        policy_decision: {
          allowed: true,
          confirmationRequired: false,
        },
      });
    } finally {
      registry.unregisterSkill(skillId);
    }
  });
});
