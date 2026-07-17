/**
 * AI 能力端口 — Domain 层对 Application 层推理能力的抽象
 *
 * Domain 层（LifeClockManager、AttentionSessionManager）需要调用 AI 推理和
 * 动作流等 Application 能力，但不得直接导入 Application 层实现。
 * 本文件定义纯接口，由 Application 层实现，在 app.ts 中注入 Domain 层。
 */
import {
  ChatMessageResponse,
  LifeHeartbeatRequest,
  LifeHeartbeatResponse,
  PerceptionCancelRequest,
  PerceptionEvent,
} from "@glimmer-cradle/protocol";

/**
 * AI 推理能力端口
 * Application 层的 AIProxy 实现此接口
 */
export interface IAICapabilityPort {
  readonly isReady: boolean;
  sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<ChatMessageResponse>;
  cancelPerception(request: PerceptionCancelRequest): Promise<void>;
  sendLifeHeartbeat(request: LifeHeartbeatRequest): Promise<LifeHeartbeatResponse>;
}

/**
 * 动作流能力端口
 * Application 层的 ActionStreamManager 实现此接口
 */
export interface IActionStreamPort {
  startThinkingStream(sceneId: string, traceId: string, sourceType: string): Promise<void>;
  completeStream(sceneId: string, traceId: string, emotion: string, replyLength: number): Promise<void>;
  cancelStream(sceneId: string, traceId: string, reason: string): Promise<void>;
}
