/**
 * 扩展可见的 Glimmer Cradle 协议投影。
 *
 * 权威定义仍在 `@glimmer-cradle/protocol`。SDK 只把扩展作者需要理解的跨边界契约
 * 暴露出来，不重新定义 Kernel、Renderer 或 Cognition 的内部模型。
 */
export type {
  ActionIntentSnapshot,
  PresentationDownstreamFrame,
  PresentationUpstreamFrame,
  CapabilityGraphEdge,
  CapabilityGraphNode,
  CapabilityNodeState,
  ChannelReplyMessage,
  ChannelReplyPayload,
  DiagnosticsSnapshot,
  DiagnosticsEntry,
  ExtensionRuntimeProjection,
  PerceptionEvent,
  ReadinessGateSnapshot,
  VisualCommand,
} from '@glimmer-cradle/protocol';
