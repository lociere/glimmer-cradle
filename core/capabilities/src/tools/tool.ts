import type { CapabilityDefinition } from '../exposure/exposure-policy.js';

/** 可执行动作的定义；executor 引用由 App 解析，Core 不接收函数或 SDK 对象。 */
export interface Tool extends CapabilityDefinition {
  readonly input_schema: unknown;
  readonly executor_id: string;
}
