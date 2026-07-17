import { describe, expect, it } from 'vitest';
import { IPCMessageType, type AgentSynthesisRequest, type IPCRequest } from '@glimmer-cradle/protocol';
import { SkillActionController, type ChannelReplyPublishRequest } from './skill-action-controller';

function actionRequest(payload: Record<string, unknown>): IPCRequest {
  return {
    type: IPCMessageType.ACTION_COMMAND,
    trace_id: 'trace-1',
    payload,
  };
}

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

function skillCommand(goal = '查一下天气') {
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

    await controller.handleActionCommand(actionRequest(skillCommand()));

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

    await controller.handleActionCommand(actionRequest(skillCommand()));

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

    await controller.handleActionCommand(actionRequest(skillCommand()));

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

    await controller.handleActionCommand(actionRequest(skillCommand()));

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

    await controller.handleActionCommand(actionRequest(skillCommand()));

    expect(replies[0]).toMatchObject({
      sceneId: 'desktop:local',
      text: '工具结果已经返回，但认知合成失败，稍后再试。',
    });
  });
});
