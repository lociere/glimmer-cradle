import type {
  AgentPlanRequest,
  AgentPlanResponse,
  ConversationContext,
  MCPToolSuggestion,
} from '@glimmer-cradle/protocol';
import { AIProxy } from '../capabilities/inference/ai-proxy';
import { SkillInvocationGateway } from '../skill-plane/skill-invocation-gateway';
import { ControlSurfaceCorePlatformBridge } from '../skill-plane/providers/core/core-platform-bridge';
import { SkillCatalogAppService } from './skill-catalog-app.service';
import { isCapabilityScopeVisible } from '../skill-plane/scope';

export interface SkillPlanningRequest {
  userGoal: string;
  sceneId?: string;
  conversation?: ConversationContext;
  traceId?: string;
}

export type AgentPlanRequester = (request: AgentPlanRequest, traceId?: string) => Promise<AgentPlanResponse>;

/**
 * Cognition 只根据目录提出建议；只有这里能把建议交给 Kernel 的统一调用网关。
 * 这让扩展或 MCP 的内部 handler 永远不会进入认知进程。
 */
export class SkillPlanningAppService {
  private static createDefaultGateway(): SkillInvocationGateway {
    const bridge = new ControlSurfaceCorePlatformBridge();
    return new SkillInvocationGateway(undefined, undefined, undefined, (request) => (
      bridge.requestConfirmation(request)
    ));
  }

  constructor(
    private readonly _catalog: SkillCatalogAppService,
    private readonly _gateway: SkillInvocationGateway = SkillPlanningAppService.createDefaultGateway(),
    private readonly _requestPlan: AgentPlanRequester = (request) => AIProxy.instance.requestAgentPlan(request),
  ) {}

  public async plan(request: SkillPlanningRequest): Promise<AgentPlanResponse> {
    const catalog = this._catalog.getCatalogSnapshot();
    const availableTools: AgentPlanRequest['available_tools'] = catalog.entries
      .filter((entry) => entry.audience === 'character'
        && (entry.metadata.runtime_status ?? 'ready') === 'ready'
        && isCapabilityScopeVisible(entry.scope, request.conversation))
      .flatMap((entry) => entry.tools.filter((tool) => (
        tool.audience === 'character' && isCapabilityScopeVisible(tool.scope, request.conversation)
      )).map((tool) => ({
        skill_id: entry.id,
        tool_name: tool.name,
        description: tool.description,
        parameters: this.toParameterObject(tool.parameters),
      })));

    const plan = await this._requestPlan(
      {
        user_goal: request.userGoal,
        scene_id: request.sceneId ?? 'default',
        available_tools: availableTools,
      },
      request.traceId,
    );

    const allowedTools = new Set(availableTools.map((tool) => `${tool.skill_id}\u0000${tool.tool_name}`));
    return {
      ...plan,
      suggestions: plan.suggestions.filter((suggestion) =>
        allowedTools.has(`${suggestion.skill_id}\u0000${suggestion.tool_name}`),
      ),
    };
  }

  public getReadyToolCount(conversation?: ConversationContext): number {
    const catalog = this._catalog.getCatalogSnapshot();
    return catalog.entries
      .filter((entry) => entry.audience === 'character'
        && (entry.metadata.runtime_status ?? 'ready') === 'ready'
        && isCapabilityScopeVisible(entry.scope, conversation))
      .reduce((total, entry) => total + entry.tools.filter((tool) => (
        tool.audience === 'character' && isCapabilityScopeVisible(tool.scope, conversation)
      )).length, 0);
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
  ): Promise<unknown> {
    return this._gateway.invoke({
      skillId: suggestion.skill_id,
      toolName: suggestion.tool_name,
      args: suggestion.arguments_hint,
      traceId,
      conversation,
    });
  }

  private toParameterObject(parameters: unknown): Record<string, unknown> {
    return parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? parameters as Record<string, unknown>
      : {};
  }
}
