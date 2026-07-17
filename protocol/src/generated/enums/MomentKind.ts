/* 自动生成 — 从 MomentKind.schema.json 生成，勿手动修改 */

/** Moment 类型。反思是带证据的认知产物，不再伪装成经历事实。 */
export type MomentKind =
  | 'perception'
  | 'emotion'
  | 'reply'
  | 'action'
  | 'action_result'
  | 'silence';

/** MomentKind 值访问对象（MomentKind.XXX）。 */
export const MomentKind = {
  PERCEPTION: 'perception',
  EMOTION: 'emotion',
  REPLY: 'reply',
  ACTION: 'action',
  ACTION_RESULT: 'action_result',
  SILENCE: 'silence',
} as const satisfies Record<string, MomentKind>;
