import type { ConversationContext } from '@glimmer-cradle/conversation';
import type { AgentPlanRequest, AgentPlanResponse } from '../../ports/cognition-service-port';
import { SkillInvocationGateway } from '../skill-plane/skill-invocation-gateway';
import { SkillCatalogAppService } from './skill-catalog-app.service';

export interface SkillPlanningRequest {
  userGoal: string;
  sceneId?: string;
  conversation?: ConversationContext;
  traceId?: string;
}

export type AgentPlanRequester = (request: AgentPlanRequest, traceId?: string) => Promise<AgentPlanResponse>;
type MCPToolSuggestion = AgentPlanResponse['suggestions'][number];

/**
 * Cognition 只根据目录提出建议；只有这里能把建议交给 Kernel 的统一调用网关。
 * 这让扩展或 MCP 的内部 handler 永远不会进入认知进程。
 */
export class SkillPlanningAppService {
  constructor(
    private readonly _catalog: SkillCatalogAppService,
    private readonly _gateway: SkillInvocationGateway,
    private readonly _requestPlan: AgentPlanRequester,
  ) {}

  public async plan(request: SkillPlanningRequest): Promise<AgentPlanResponse> {
    const context = request.conversation ? { ...request.conversation } : undefined;
    const tools = () => this._catalog.listReadyTools(context)
      .map(tool => ({ ...tool, parameters: this.toParameterObject(tool.parameters) }));
    let availableTools = tools();
    const summaries = this._catalog.listReadyMethods(context);
    const initial = await this._requestPlan({
      user_goal: request.userGoal, scene_id: request.sceneId ?? 'default',
      available_tools: availableTools, available_skills: summaries, skill_materials: [],
    }, request.traceId);
    const exposed = new Map(summaries.map(summary => [summary.reference.skill_id, summary.reference]));
    const selected = [...new Map((initial.selected_skills ?? []).filter(reference =>
      exposed.get(reference.skill_id)?.definition_revision === reference.definition_revision
    ).map(reference => [reference.skill_id, exposed.get(reference.skill_id)!])).values()].slice(0, 2);
    const materials = selected.flatMap(reference => {
      const material = this._catalog.readMethod(reference, context);
      return material ? [material] : [];
    });
    if (materials.reduce((bytes, material) => bytes + new TextEncoder().encode(material.instructions).length, 0) > 64 * 1024) {
      throw new Error('Skill material byte budget exceeded');
    }
    let plan = initial;
    if (materials.length > 0) {
      availableTools = tools();
      // 正文只作为独立不可信材料，不伪装成 Tool 调用、执行结果或新的用户目标。
      plan = await this._requestPlan({
        user_goal: request.userGoal, scene_id: request.sceneId ?? 'default',
        available_tools: availableTools, available_skills: [], skill_materials: materials,
      }, request.traceId);
      if (materials.some(material => this._catalog.readMethod(material.reference, context)?.instructions !== material.instructions)) {
        throw new Error('Skill material revoked_before_plan_commit');
      }
    }
    const currentTools = new Set(tools().map(tool => JSON.stringify([tool.skill_id, tool.tool_name])));
    const allowedTools = new Set(availableTools.map(tool => JSON.stringify([tool.skill_id, tool.tool_name])));
    return {
      ...plan,
      selected_skills: materials.map(material => material.reference),
      suggestions: plan.suggestions.filter(suggestion => {
        const key = JSON.stringify([suggestion.skill_id, suggestion.tool_name]);
        return allowedTools.has(key) && currentTools.has(key);
      }),
    };
  }

  public getReadyToolCount(conversation?: ConversationContext): number {
    return this._catalog.listReadyTools(conversation).length;
  }

  public resultEventId(invocationId: string): string | undefined {
    return this._gateway.resultEventId(invocationId);
  }

  public getSkillSource(skillId: string): { providerKind: 'core' | 'extension' | 'mcp' | 'user'; providerId: string } {
    const provider = this._catalog.findCatalogEntry(skillId)?.provider;
    const providerKind = provider?.kind === 'mcp_server' ? 'mcp' : provider?.kind ?? 'core';
    return { providerKind, providerId: provider?.id ?? 'kernel.skill-plane' };
  }

  public async executeSuggestion(
    suggestion: MCPToolSuggestion,
    traceId?: string,
    conversation?: ConversationContext,
    signal?: AbortSignal,
    invocationId?: string,
    sourceFactId?: string,
  ): Promise<unknown> {
    return this._gateway.invoke({
      skillId: suggestion.skill_id,
      toolName: suggestion.tool_name,
      args: suggestion.arguments_hint,
      traceId,
      conversation,
      signal,
      invocationId,
      sourceFactId,
    });
  }

  private toParameterObject(parameters: unknown): Record<string, unknown> {
    return parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? parameters as Record<string, unknown>
      : {};
  }
}
