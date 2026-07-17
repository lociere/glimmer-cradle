/* 自动生成 — 从 CapabilityScope.schema.json 生成，勿手动修改 */

/**
 * 能力在全局、来源、场景或会话边界内的可见范围。
 */
export type CapabilityScope =
  | {
      kind: 'global';
    }
  | {
      kind: 'source_provider' | 'scene' | 'conversation';
      /**
       * @minItems 1
       */
      ids: [string, ...string[]];
    };
