import type { CapabilityDefinition } from '../exposure/exposure-policy.js';

/** 可读资源；内容与版本由 reader 管理，注册定义不缓存平台资源字节。 */
export interface Resource extends CapabilityDefinition {
  readonly input_schema: unknown;
  readonly reader_id: string;
}
