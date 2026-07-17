/* 自动生成 — 从 ModelInvocationCaptureMode.schema.json 生成，勿手动修改 */

/** 模型调用观测采集模式。off 不记录，summary 仅摘要，full 显式保留完整 capture。 */
export type ModelInvocationCaptureMode =
  | 'off'
  | 'summary'
  | 'full';

/** ModelInvocationCaptureMode 值访问对象（ModelInvocationCaptureMode.XXX）。 */
export const ModelInvocationCaptureMode = {
  OFF: 'off',
  SUMMARY: 'summary',
  FULL: 'full',
} as const satisfies Record<string, ModelInvocationCaptureMode>;
