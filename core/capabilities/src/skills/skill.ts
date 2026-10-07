import type { CapabilityDefinition } from '../exposure/exposure-policy.js';

/** 方法知识不是 Tool 容器；动态方法通过 reader 引用加载，description 不冒充正文。 */
export interface Skill extends CapabilityDefinition {
  readonly instructions:
    | { readonly kind: 'inline'; readonly text: string }
    | { readonly kind: 'reader'; readonly reader_id: string; readonly input_schema: unknown };
}
