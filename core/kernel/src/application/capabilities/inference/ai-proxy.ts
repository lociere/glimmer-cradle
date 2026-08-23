/**
 * AIProxy — Cognition 认知能力的统一 Promise 门面
 * 上层模块仅依赖该门面，不感知 IPC/子进程通信细节。
 */
import type { PerceptionEvent } from '../../../ports/application-models';
import type {
  AgentPlanRequest,
  AgentPlanResponse,
  AgentSynthesisRequest,
  AgentSynthesisResponse,
  LifeHeartbeatResponse,
  PerceptionCancelRequest,
  PerceptionOperationHandle,
} from "../../../ports/cognition-service-port";
export interface CognitionApplicationPort {
  readonly isReady: boolean;
  sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<PerceptionOperationHandle>;
  cancelPerception(request: PerceptionCancelRequest): Promise<void>;
  sendAgentPlan(request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse>;
  sendAgentSynthesis(request: AgentSynthesisRequest, signal?: AbortSignal): Promise<AgentSynthesisResponse>;
  sendLifeHeartbeat(request: Record<string, never>): Promise<LifeHeartbeatResponse>;
}

export class AIProxy {
  public constructor(private readonly cognition: CognitionApplicationPort) {}

  public get isReady(): boolean {
    return this.cognition.isReady;
  }

  public async sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<PerceptionOperationHandle> {
    return this.cognition.sendPerceptionMessage(request, traceId);
  }

  public async cancelPerception(request: PerceptionCancelRequest): Promise<void> {
    await this.cognition.cancelPerception(request);
  }

  public async requestAgentPlan(request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse> {
    return this.cognition.sendAgentPlan(request, traceId);
  }

  public async requestAgentSynthesis(request: AgentSynthesisRequest, signal?: AbortSignal): Promise<AgentSynthesisResponse> {
    return this.cognition.sendAgentSynthesis(request, signal);
  }

  public async sendLifeHeartbeat(request: Record<string, never>): Promise<LifeHeartbeatResponse> {
    return this.cognition.sendLifeHeartbeat(request);
  }

}
