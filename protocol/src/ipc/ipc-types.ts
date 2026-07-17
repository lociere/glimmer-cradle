/**
 * IPC协议类型定义
 * 用于内核与 Cognition 认知核之间的 IPC 消息传递。
 */
// IPCMessageType 单一事实源是 schemas/enums/IPCMessageType.schema.json
// （Protocol 契约铁律 1，阶段 P.3c）。本文件仅用其类型；值访问由调用方从
// generated 取（barrel 已导出）。
import type {
  AgentPlanPayload,
  AgentPlanResult,
  AgentSynthesisPayload,
  ErrorCode,
  PerceptionModalitySemantic,
  PerceptionModalityItem,
  AgentToolResult,
  IPCMessageType,
  LifeHeartbeatResult,
} from "../generated";

/**
 * IPC消息分类：用于日志、路由和扩展时保持语义清晰。
 */
export enum IPCMessageCategory {
  PERCEPTION = "perception",
  COGNITION = "cognition",
  INFERENCE = "inference",
  SYNC = "sync",
  CONTROL = "control",
  OBSERVABILITY = "observability",
  RESPONSE = "response",
}

export interface IPCRequest {
  type: IPCMessageType;
  trace_id: string;
  /** 父 span（用于跨进程 span 嵌套）；无 span 时省略。 */
  span_id?: string;
  payload: any;
}

export interface IPCResponse {
  type: IPCMessageType;
  trace_id: string;
  success: boolean;
  payload?: any;
  error?: {
    code: ErrorCode;
    message: string;
  };
}

export function createIPCRequest(
  type: IPCMessageType,
  trace_id: string,
  payload: any = {},
  span_id?: string,
): IPCRequest {
  return span_id ? { type, trace_id, span_id, payload } : { type, trace_id, payload };
}

export function createSuccessResponse(type: IPCMessageType, trace_id: string, payload: any = {}): IPCResponse {
  return { type, trace_id, success: true, payload };
}

export function createErrorResponse(
  type: IPCMessageType,
  trace_id: string,
  code: ErrorCode,
  message: string
): IPCResponse {
  return {
    type,
    trace_id,
    success: false,
    error: { code, message },
  };
}

// 下面是常用的业务类型定义（可根据需要扩展）

export type MessageSourceType = "private" | "group" | "channel" | "terminal" | "system" | "unknown";
export type SceneSessionPolicy = "by_source" | "by_actor";

export type PerceptionModalityType = "text" | "image" | "video";

/**
 * 上游来源元数据：只保留跨平台通用字段，禁止平台私有协议字段进入AI层。
 */
export interface MessageSourceMeta {
  adapter_id: string;
  source_type: MessageSourceType;
  source_id: string;
}

export interface MessageActorMeta {
  actor_id: string;
  actor_name?: string;
}

export interface SceneRoutingHint {
  session_policy?: SceneSessionPolicy;
  actor?: MessageActorMeta;
}

export interface ModelInputPayload {
  items: PerceptionModalityItem[];
}

export interface PerceptionCancelRequest {
  scene_id: string;
  target_trace_id: string;
  reason?: string;
}

export interface ChatMessageResponse {
  reply_content: string;
  emotion_state: Record<string, any>;
  trace_id: string;
}

/** Agent Plan 的请求与响应均由 IPC schema 生成，禁止在两端手写镜像。 */
export type AgentPlanRequest = AgentPlanPayload;

export type AgentSynthesisRequest = AgentSynthesisPayload & { trace_id?: string };

// AgentToolResult 单一事实源是 schemas/ipc/AgentSynthesisPayload.schema.json
// （Protocol 契约铁律 1，阶段 P.3b）—— 原手写 interface 已删，从 generated 导出。

export interface AgentSynthesisResponse {
  reply_content: string;
  emotion_state: Record<string, any>;
  trace_id: string;
}

// KnowledgeInit IPC 类型单一事实源是 schemas/ipc/KnowledgeInitPayload.schema.json
// （Protocol 契约铁律 1，阶段 P.4b）—— 原手写 IPCKnowledge* / KnowledgeInitRequest
// 已删，消费方改 import { KnowledgeInitPayload, KnowledgeBaseInitPayload,
// KernelKnowledgeRecord, IPCKnowledgeRetrievalConfig } from '@glimmer-cradle/protocol'

export type MCPToolSuggestion = AgentPlanResult['suggestions'][number];
export type AgentPlanResponse = AgentPlanResult;

export type LifeHeartbeatRequest = Record<string, never>;

export type LifeHeartbeatResponse = LifeHeartbeatResult;
