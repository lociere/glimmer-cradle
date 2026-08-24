/* Extension SDK 的 schema-derived manifest projection；serialized shape 由 contracts/json-schema/extension/v1 拥有。 */

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
