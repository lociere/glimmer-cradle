// Protocol owns versioned, serializable rules shared across process, language,
// product, and extension boundaries. Kernel ports and SDK authoring APIs remain
// in their respective owners and consume these contracts one way.

export * from './models';
export * from './ipc/ipc-types';
export * from './extension';
export * from './product';

// 配置 JSON Schema 集合（kernel ajv 运行时校验源）
export { ConfigSchemas } from './config-schemas';

// 跨包公共校验与 Presentation Plane helper。
export {
  PRESENTATION_AVATAR_CONTROL_KINDS,
  PRESENTATION_EXPRESSION_FLOW_KINDS,
  PRESENTATION_STATE_KINDS,
  getPresentationFrameClass,
  isPresentationAvatarControlKind,
  isPresentationExpressionFlowKind,
  isPresentationFrameKind,
  isPresentationStateKind,
  type PresentationFrameClass,
  type PresentationFrameKind,
} from './presentation/presentation-frame';
export {
  normalizeReplyMessages,
  type NormalizedReplyMessage,
  type ReplyMessageContentType,
} from './presentation/reply-messages';
export {
  normalizeSystemYamlNulls,
} from './validation/yaml-normalizers';
export {
  validateConfig,
  type ConfigSchemaName,
  type ValidationResult,
} from './validation/validator';

// Schema-First 自动生成的契约类型
export * from './generated';
