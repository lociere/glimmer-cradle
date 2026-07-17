/* 自动生成 — 从 MemoryKind.schema.json 生成，勿手动修改 */

/** Cognition 长期记忆的语义种类。多模态是内容形态，不是记忆种类。 */
export type MemoryKind =
  | 'episodic'
  | 'semantic'
  | 'social'
  | 'autobiographical'
  | 'prospective'
  | 'procedural';

/** MemoryKind 值访问对象（MemoryKind.XXX）。 */
export const MemoryKind = {
  EPISODIC: 'episodic',
  SEMANTIC: 'semantic',
  SOCIAL: 'social',
  AUTOBIOGRAPHICAL: 'autobiographical',
  PROSPECTIVE: 'prospective',
  PROCEDURAL: 'procedural',
} as const satisfies Record<string, MemoryKind>;
