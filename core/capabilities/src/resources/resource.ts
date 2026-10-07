import type { CapabilityDefinition } from '../exposure/exposure-policy.js';
import type { CapabilityReference } from '../exposure/step-surface.js';
import { createHash } from 'node:crypto';
import { executionJson } from '../execution/invocation.js';

/** 可读资源；内容与版本由 reader 管理，注册定义不缓存平台资源字节。 */
export interface Resource extends CapabilityDefinition {
  readonly input_schema: unknown;
  readonly reader_id: string;
}

export interface ResourceContent {
  readonly reference: CapabilityReference;
  readonly content_revision: string;
  readonly media_type: 'text/plain' | 'application/json';
  readonly content_utf8: string;
}

/** 内容身份独立于目录定义版本；只接受有界文本/规范 JSON，不缓存 reader 或平台对象。 */
export function resourceContentFromValue(reference: CapabilityReference, value: unknown): ResourceContent {
  const content = typeof value === 'string' ? value : executionJson(value);
  if (new TextEncoder().encode(content).length > 32 * 1024) throw new Error('Resource 内容超过预算');
  return { reference: { ...reference }, content_revision: createHash('sha256').update(content, 'utf8').digest('hex'),
    media_type: typeof value === 'string' ? 'text/plain' : 'application/json', content_utf8: content };
}
