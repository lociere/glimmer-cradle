/**
 * AIProxy — Cognition 认知能力的统一 Promise 门面
 * 上层模块仅依赖该门面，不感知 IPC/子进程通信细节。
 */
import {
  AgentPlanRequest,
  AgentPlanResponse,
  AgentSynthesisRequest,
  AgentSynthesisResponse,
  ChatMessageResponse,
  LifeHeartbeatRequest,
  LifeHeartbeatResponse,
  PerceptionCancelRequest,
  PerceptionEvent,
} from "@glimmer-cradle/protocol";
import { CognitionManager } from "./cognition-manager";

export class AIProxy {
  private static _instance: AIProxy | null = null;

  public static get instance(): AIProxy {
    if (!AIProxy._instance) {
      AIProxy._instance = new AIProxy();
    }
    return AIProxy._instance;
  }

  private constructor() {}

  public get isReady(): boolean {
    return CognitionManager.instance.isReady;
  }

  public async sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<ChatMessageResponse> {
    return CognitionManager.instance.sendPerceptionMessage(request, traceId);
  }

  public async cancelPerception(request: PerceptionCancelRequest): Promise<void> {
    await CognitionManager.instance.cancelPerception(request);
  }

  public async requestAgentPlan(request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse> {
    return CognitionManager.instance.sendAgentPlan(request, traceId);
  }

  public async requestAgentSynthesis(request: AgentSynthesisRequest): Promise<AgentSynthesisResponse> {
    return CognitionManager.instance.sendAgentSynthesis(request);
  }

  public async sendLifeHeartbeat(request: LifeHeartbeatRequest): Promise<LifeHeartbeatResponse> {
    return CognitionManager.instance.sendLifeHeartbeat(request);
  }

}
