// Extension authors consume these owner-local SDK projections. Canonical Service
// DTOs remain in Contract Spine and are mapped at the Host/Surface adapters.
export * from './ActionCommand';
export * from './ChannelReplyPayload';
export * from './ConversationAddress';
export * from './ConversationContext';
export * from './ConversationNotice';
export * from './PerceptionEvent';
export * from './VisualCommand';
export type {
  ActionIntentSnapshot, ActionIntentState, CapabilityGraphEdge, CapabilityGraphNode,
  CapabilityNodeState, ContributionPointDefinitionSnapshot, DiagnosticsEntry,
  DiagnosticsSnapshot, ReadinessGateSnapshot,
} from '../../host/lifecycle-projection';
