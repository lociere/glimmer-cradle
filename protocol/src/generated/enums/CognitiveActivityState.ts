/* 自动生成 — 从 CognitiveActivityState.schema.json 生成，勿手动修改 */

/** 当前角色的认知活动档位。quiescent=静息；ambient=低频环境感知；engaged=完整交互。它是调度投影，不是情感唤醒度或 Experience Moment。 */
export type CognitiveActivityState =
  | 'quiescent'
  | 'ambient'
  | 'engaged';

/** CognitiveActivityState 值访问对象（CognitiveActivityState.XXX）。 */
export const CognitiveActivityState = {
  QUIESCENT: 'quiescent',
  AMBIENT: 'ambient',
  ENGAGED: 'engaged',
} as const satisfies Record<string, CognitiveActivityState>;
