import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionController, SqliteExecutionJournal } from '@glimmer-cradle/capabilities';
import {
  SkillInvocationGateway,
  type SkillInvocationAuditRecord,
  type SkillInvocationAuditSink,
} from '../../src/application/skill-plane/skill-invocation-gateway';
import { SkillRegistry } from '../../src/application/skill-plane/skill-registry';
import { SkillPolicyEngine } from '../../src/application/skill-plane/skill-policy-engine';
import type { SkillConfirmationRequester } from '../../src/ports/skill-plane.port';
import type { Observability as KernelObservabilityPort } from '@glimmer-cradle/platform/observability';

class MemoryAuditSink implements SkillInvocationAuditSink {
  public readonly records: SkillInvocationAuditRecord[] = [];

  public record(record: SkillInvocationAuditRecord): void {
    this.records.push(record);
  }
}

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

function createGateway(
  registry: SkillRegistry,
  audit: SkillInvocationAuditSink = { record: () => undefined },
  requestConfirmation?: SkillConfirmationRequester,
): SkillInvocationGateway {
  return new SkillInvocationGateway(
    registry,
    new SkillPolicyEngine(),
    audit,
    observability,
    { record: () => undefined },
    requestConfirmation,
  );
}

describe('SkillInvocationGateway', () => {
  it('用户拒绝落持久未派发结果，再次请求不弹框、不执行 handler', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-gateway-denied-')); const journal = new SqliteExecutionJournal(join(root, 'execution.sqlite'));
    const registry = new SkillRegistry(); const handler = vi.fn(); const confirm = vi.fn(async () => false);
    registry.registerSkill({ id: 'test.denied', name: '测试', description: '拒绝', provider: { kind: 'core', id: 'receiver' },
      policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['external'], audit: true },
      tools: [{ name: 'run', description: 'run', parameters: {}, handler }] });
    const gateway = new SkillInvocationGateway(registry, new SkillPolicyEngine(), { record: () => undefined },
      observability, { record: () => undefined }, confirm, new ExecutionController(journal));
    try {
      const request = { skillId: 'test.denied', toolName: 'run', args: {}, invocationId: 'stable' };
      await expect(gateway.invoke(request)).rejects.toThrow('用户拒绝');
      await expect(gateway.invoke(request)).rejects.toThrow('authorization_denied');
      expect(confirm).toHaveBeenCalledOnce(); expect(handler).not.toHaveBeenCalled();
      expect(journal.load('stable')).toMatchObject({ state: 'failed', attempt: 0, authorization: { allowed: false }, side_effects: 'none' });
      expect(journal.readOutbox(10)).toHaveLength(1);
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
  it('真实 journal 重开重放成功结果，诊断故障不改写成功、不重复副作用', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-gateway-execution-')); const file = join(root, 'execution.sqlite');
    let journal = new SqliteExecutionJournal(file);
    const registry = new SkillRegistry(); const handler = vi.fn(async (args) => ({ ok: true, args }));
    registry.registerSkill({ id: 'test.execution', name: '测试', description: '执行', provider: { kind: 'core', id: 'receiver' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: ['external'], audit: true },
      tools: [{ name: 'run', description: 'run', parameters: { type: 'object' }, handler }] });
    const gateway = () => new SkillInvocationGateway(registry, new SkillPolicyEngine(),
      { record: () => { throw new Error('audit unavailable'); } }, observability, { record: () => undefined },
      undefined, new ExecutionController(journal));
    const request = { skillId: 'test.execution', toolName: 'run', args: { text: '参数' }, invocationId: 'stable:1' };
    try {
      await expect(gateway().invoke(request)).resolves.toEqual({ ok: true, args: request.args });
      expect(handler.mock.calls[0][1].invocationId).toBe('stable:1');
      journal.close(); journal = new SqliteExecutionJournal(file);
      await expect(gateway().invoke(request)).resolves.toEqual({ ok: true, args: request.args });
      expect(handler).toHaveBeenCalledOnce(); expect(journal.readOutbox(10)).toHaveLength(1);
      await expect(gateway().invoke({ ...request, args: 'changed' })).rejects.toThrow('冲突');
      expect(handler).toHaveBeenCalledOnce();
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
  it.each(['unregister', 'policy', 'scope', 'handler', 'readiness'])('确认期间 %s 变更，派发前真实复验拒绝执行', async (change) => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-gateway-revoked-')); const journal = new SqliteExecutionJournal(join(root, 'execution.sqlite'));
    const registry = new SkillRegistry(); const handler = vi.fn();
    registry.registerSkill({ id: 'test.revoked', name: '测试', description: '撤销', provider: { kind: 'core', id: 'receiver' },
      policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['external'], audit: true },
      tools: [{ name: 'run', description: 'run', parameters: {}, handler }] });
    const confirmation = async () => {
      const skill = registry.findById('test.revoked')!.skill;
      if (change === 'unregister') registry.unregisterSkill(skill.id);
      if (change === 'policy') skill.policy.sideEffects.push('new-effect');
      if (change === 'scope') skill.scope = { kind: 'conversation', ids: ['other'] };
      if (change === 'handler') skill.tools[0].handler = () => 'replacement';
      if (change === 'readiness') skill.metadata = { runtime_status: 'contract_only' };
      return true;
    };
    const gateway = new SkillInvocationGateway(registry, new SkillPolicyEngine(), { record: () => undefined },
      observability, { record: () => undefined }, confirmation, new ExecutionController(journal));
    try {
      await expect(gateway.invoke({ skillId: 'test.revoked', toolName: 'run', args: {}, invocationId: 'stable' })).rejects.toThrow('revoked_before_dispatch');
      expect(handler).not.toHaveBeenCalled();
      expect(journal.load('stable')).toMatchObject({ state: 'failed', attempt: 0, side_effects: 'none' });
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
  it('接收方抛错始终 unknown，即使声明没有 sideEffects；不作为普通失败重试', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-gateway-unknown-')); const journal = new SqliteExecutionJournal(join(root, 'execution.sqlite'));
    const registry = new SkillRegistry(); const handler = vi.fn(() => { throw new Error('lost receipt'); }); const audit = new MemoryAuditSink();
    registry.registerSkill({ id: 'test.unknown', name: '测试', description: 'unknown', provider: { kind: 'core', id: 'receiver' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{ name: 'run', description: 'run', parameters: {}, handler }] });
    const gateway = new SkillInvocationGateway(registry, new SkillPolicyEngine(), audit, observability,
      { record: () => undefined }, undefined, new ExecutionController(journal));
    try {
      const request = { skillId: 'test.unknown', toolName: 'run', args: {}, invocationId: 'stable' };
      await expect(gateway.invoke(request)).rejects.toThrow('需要人工恢复');
      await expect(gateway.invoke(request)).rejects.toThrow('需要人工恢复');
      expect(handler).toHaveBeenCalledOnce(); expect(audit.records.map(item => item.status)).toEqual(['unknown', 'unknown']);
      expect(journal.load('stable')).toMatchObject({ state: 'unknown', attempt: 1 });
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
  it('调用成功时记录 provider、policy、trace 与结果摘要', async () => {
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry, audit);
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
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry, audit);
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
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry);
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
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry);
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
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry, audit, async (request) => {
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
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry, audit, async () => false);
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
    const registry = new SkillRegistry();
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
      const gateway = createGateway(registry, audit);
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
