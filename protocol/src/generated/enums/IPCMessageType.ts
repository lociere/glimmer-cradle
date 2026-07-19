/* 自动生成 — 从 IPCMessageType.schema.json 生成，勿手动修改 */

/** Kernel 与 Cognition 之间的 IPC 消息类型。Cognition 独占人格、经历和记忆语义；Kernel 不触发记忆固化。 */
export type IPCMessageType =
  | 'perception_message'
  | 'perception_cancel'
  | 'agent_plan'
  | 'agent_synthesis'
  | 'conversation_history'
  | 'life_heartbeat'
  | 'cognition_shutdown'
  | 'state_sync'
  | 'action_command'
  | 'log'
  | 'config_init'
  | 'knowledge_init'
  | 'success_response'
  | 'error_response';

/** IPCMessageType 值访问对象（IPCMessageType.XXX）。 */
export const IPCMessageType = {
  PERCEPTION_MESSAGE: 'perception_message',
  PERCEPTION_CANCEL: 'perception_cancel',
  AGENT_PLAN: 'agent_plan',
  AGENT_SYNTHESIS: 'agent_synthesis',
  CONVERSATION_HISTORY: 'conversation_history',
  LIFE_HEARTBEAT: 'life_heartbeat',
  COGNITION_SHUTDOWN: 'cognition_shutdown',
  STATE_SYNC: 'state_sync',
  ACTION_COMMAND: 'action_command',
  LOG: 'log',
  CONFIG_INIT: 'config_init',
  KNOWLEDGE_INIT: 'knowledge_init',
  SUCCESS_RESPONSE: 'success_response',
  ERROR_RESPONSE: 'error_response',
} as const satisfies Record<string, IPCMessageType>;
