/* 自动生成 — 从 MemoryStatus.schema.json 生成，勿手动修改 */

/** 记忆修订的认知状态。状态变化保留历史，不覆盖证据。 */
export type MemoryStatus =
  | 'candidate'
  | 'active'
  | 'disputed'
  | 'superseded'
  | 'redacted';

/** MemoryStatus 值访问对象（MemoryStatus.XXX）。 */
export const MemoryStatus = {
  CANDIDATE: 'candidate',
  ACTIVE: 'active',
  DISPUTED: 'disputed',
  SUPERSEDED: 'superseded',
  REDACTED: 'redacted',
} as const satisfies Record<string, MemoryStatus>;
