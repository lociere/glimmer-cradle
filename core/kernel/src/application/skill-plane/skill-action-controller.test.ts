import { describe, expect, it } from 'vitest';
import type { ActionCommand } from '@glimmer-cradle/protocol';
import type { AgentSynthesisRequest } from '../../ports/cognition-service-port';
import { SkillActionController, type ChannelReplyPublishRequest } from './skill-action-controller';
import { RecoveryRequiredError } from '../../domain/errors';

function createPlanning(overrides: Partial<{
  readyToolCount: number;
  suggestions: Array<Record<string, unknown>>;
  executeResult: unknown;
  executeError: Error;
  providerKind: 'core' | 'extension' | 'mcp' | 'user';
  providerId: string;
}> = {}) {
  return {
    getReadyToolCount: () => overrides.readyToolCount ?? 1,
    getSkillSource: () => ({
      providerKind: overrides.providerKind ?? 'core',
      providerId: overrides.providerId ?? 'core-skills',
    }),
    plan: async () => ({
      summary: 'plan',
      reasoning: 'reason',
      suggestions: overrides.suggestions ?? [{
        skill_id: 'core.weather',
        tool_name: 'get_weather',
        purpose: '查询天气',
        confidence: 0.9,
        arguments_hint: { city: '上海' },
      }],
      trace_id: 'trace-1',
    }),
    executeSuggestion: async () => {
      if (overrides.executeError) {
        throw overrides.executeError;
      }
      return overrides.executeResult ?? { temperature: 26 };
    },
  };
}

function skillCommand(goal = '查一下天气'): ActionCommand {
  return {
    trace_id: 'trace-1',
    action_type: 'skill_request',
    target: { scene_id: 'desktop:local' },
    payload: {
      skill_request: {
        original_goal: goal,
        capability_kind: 'realtime_lookup',
        confidence: 0.9,
        reason: '需要实时天气',
        conversation: {
          source_provider_id: 'desktop', scene_id: 'desktop:local', conversation_id: 'conversation-1',
          continuity_id: 'continuity-1', thread_id: 'main', interaction_id: 'trace-1',
          recall_scope: 'conversation_private', disclosure_scope: 'conversation_private',
        },
      },
    },
  };
}

describe('SkillActionController', () => {
  it('executes planned skill and publishes synthesized reply', async () => {
    const synthesisRequests: AgentSynthesisRequest[] = [];
    const replies: ChannelReplyPublishRequest[] = [];
    const controller = new SkillActionController(
      createPlanning() as any,
      async (request) => {
        synthesisRequests.push(request);
        return { reply_content: '天气是 26 度', emotion_state: { emotion_type: 'calm' }, trace_id: 'trace-1' };
      },
      async (reply) => { replies.push(reply); },
    );

    await controller.handleActionCommand(skillCommand());

    expect(synthesisRequests[0].tool_results[0].status).toBe('success');
    expect(synthesisRequests[0].tool_results[0].tool_name).toBe('get_weather');
    expect(synthesisRequests[0].tool_results[0]).toMatchObject({
      provider_kind: 'core',
      provider_id: 'core-skills',
      schema_ref: 'glimmer://skill/action-result/v1',
    });
    expect(synthesisRequests[0].tool_results[0].source_event_id).toBe(
      synthesisRequests[0].tool_results[0].invocation_id,
    );
    expect(JSON.parse(synthesisRequests[0].tool_results[0].result_json).result.temperature).toBe(26);
    expect(replies[0]).toMatchObject({
      traceId: 'trace-1',
      sceneId: 'desktop:local',
      text: '天气是 26 度',
    });
  });

  it('synthesizes no-ready-skill as skipped tool result', async () => {
    const synthesisRequests: AgentSynthesisRequest[] = [];
    const controller = new SkillActionController(
      createPlanning({ readyToolCount: 0, suggestions: [] }) as any,
      async (request) => {
        synthesisRequests.push(request);
        return { reply_content: '现在没有可用工具', emotion_state: {}, trace_id: 'trace-1' };
      },
      async () => {},
    );

    await controller.handleActionCommand(skillCommand());

    const result = JSON.parse(synthesisRequests[0].tool_results[0].result_json);
    expect(synthesisRequests[0].tool_results[0].status).toBe('skipped');
    expect(result.reason).toBe('no_ready_skill');
  });

  it('synthesizes no-suitable-skill when ready catalog has no matching suggestion', async () => {
    const synthesisRequests: AgentSynthesisRequest[] = [];
    const controller = new SkillActionController(
      createPlanning({ readyToolCount: 2, suggestions: [] }) as any,
      async (request) => {
        synthesisRequests.push(request);
        return { reply_content: '没有合适工具', emotion_state: {}, trace_id: 'trace-1' };
      },
      async () => {},
    );

    await controller.handleActionCommand(skillCommand());

    const result = JSON.parse(synthesisRequests[0].tool_results[0].result_json);
    expect(result.reason).toBe('no_suitable_skill');
  });

  it('returns execution denial or handler failure as error tool result', async () => {
    const synthesisRequests: AgentSynthesisRequest[] = [];
    const controller = new SkillActionController(
      createPlanning({ executeError: new Error('技能 core.weather 被策略拒绝') }) as any,
      async (request) => {
        synthesisRequests.push(request);
        return { reply_content: '不能执行', emotion_state: {}, trace_id: 'trace-1' };
      },
      async () => {},
    );

    await controller.handleActionCommand(skillCommand());

    const result = synthesisRequests[0].tool_results[0];
    expect(result.status).toBe('error');
    expect(JSON.parse(result.result_json).error).toContain('策略拒绝');
  });

  it('publishes controlled fallback when synthesis RPC fails', async () => {
    const replies: ChannelReplyPublishRequest[] = [];
    const controller = new SkillActionController(
      createPlanning() as any,
      async () => { throw new Error('synthesis down'); },
      async (reply) => { replies.push(reply); },
    );

    await controller.handleActionCommand(skillCommand());

    expect(replies[0]).toMatchObject({
      sceneId: 'desktop:local',
      text: '工具结果已经返回，但认知合成失败，稍后再试。',
    });
  });

  it.each(['cancel', 'deadline'])('propagates %s while synthesis is pending without publishing fallback', async (reason) => {
    const replies: ChannelReplyPublishRequest[] = [];
    let synthesisStarted!: () => void;
    const entered = new Promise<void>((resolve) => { synthesisStarted = resolve; });
    const controller = new SkillActionController(
      createPlanning() as any,
      async (_request, signal) => {
        synthesisStarted();
        return new Promise((_resolve, reject) => signal?.addEventListener(
          'abort', () => reject(signal.reason), { once: true },
        ));
      },
      async (reply) => { replies.push(reply); },
    );
    const abort = new AbortController();
    const pending = controller.handleActionCommand(skillCommand(), abort.signal, `action:${reason}`);
    await entered;
    abort.abort(reason === 'deadline'
      ? new Error('Kernel action deadline 已到期')
      : new DOMException('调用已取消', 'AbortError'));

    await expect(pending).rejects.toBe(abort.signal.reason);
    expect(replies).toEqual([]);
  });

  it('resumes from committed tool step after cancellation without replaying the side effect', async () => {
    let executeCount = 0;
    let stableInvocationId = '';
    const planning = createPlanning() as any;
    planning.executeSuggestion = async (...args: unknown[]) => {
      executeCount += 1;
      stableInvocationId = String(args[4]);
      return { temperature: 26 };
    };
    let synthesisCount = 0;
    let firstSynthesisStarted!: () => void;
    const entered = new Promise<void>((resolve) => { firstSynthesisStarted = resolve; });
    const replies: ChannelReplyPublishRequest[] = [];
    const controller = new SkillActionController(
      planning,
      async (_request, signal) => {
        synthesisCount += 1;
        if (synthesisCount === 1) {
          firstSynthesisStarted();
          return new Promise((_resolve, reject) => signal?.addEventListener(
            'abort', () => reject(signal.reason), { once: true },
          ));
        }
        return { reply_content: '恢复完成', emotion_state: {}, trace_id: 'trace-1' };
      },
      async (reply) => { replies.push(reply); },
    );
    const firstAbort = new AbortController();
    const first = controller.handleActionCommand(skillCommand(), firstAbort.signal, 'action:stable-operation');
    await entered;
    firstAbort.abort(new DOMException('调用已取消', 'AbortError'));
    await expect(first).rejects.toBe(firstAbort.signal.reason);

    await expect(controller.handleActionCommand(
      skillCommand(), new AbortController().signal, 'action:stable-operation',
    )).resolves.toEqual({ status: 'completed' });
    expect(executeCount).toBe(1);
    expect(stableInvocationId).toBe('action:stable-operation:tool:0:core.weather:get_weather');
    expect(replies).toHaveLength(1);
  });

  it('blocks automatic replay when an abort leaves a side-effect terminal state unknown', async () => {
    let executeCount = 0;
    const planning = createPlanning() as any;
    planning.executeSuggestion = async () => {
      executeCount += 1;
      throw new RecoveryRequiredError('action:unsafe:tool:0');
    };
    const controller = new SkillActionController(planning, async () => ({
      reply_content: 'unused', emotion_state: {}, trace_id: 'trace-1',
    }), async () => undefined);

    const first = await controller.handleActionCommand(
      skillCommand(), undefined, 'action:unsafe',
    ).catch((error: unknown) => error);
    const retry = await controller.handleActionCommand(
      skillCommand(), undefined, 'action:unsafe',
    ).catch((error: unknown) => error);
    expect(first).toMatchObject({
      code: 'recovery_required',
      operationId: 'action:unsafe:tool:0',
      recoveryActions: ['confirm_side_effect_state'],
    });
    expect(retry).toBe(first);
    expect(executeCount).toBe(1);
  });
});
