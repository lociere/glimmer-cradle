import type { ConfigurationValidator } from './schema.js';

export interface ConfigurationLoadOptions<Name extends string> {
  readonly schema: Name;
  readonly validator: ConfigurationValidator<Name>;
  /** Parser 返回本次读取独占的文档；格式与 alias 等规则由 App adapter 决定。 */
  readonly parse: (text: string) => unknown;
  readonly maxBytes: number;
}

/** 只发布完整校验后的不可变文档；读取路径及实际 IO 仍归调用方。 */
export function loadConfiguration<T, Name extends string>(bytes: Uint8Array, options: ConfigurationLoadOptions<Name>): Readonly<T> {
  try {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || bytes.byteLength > options.maxBytes) {
      throw new Error('配置超过读取上限');
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.startsWith('\uFEFF')) throw new Error('配置包含 BOM');
    const result = options.validator.validate<T>(options.schema, options.parse(text));
    if (!result.ok) throw new Error('配置 Schema 无效');
    return freezeConfiguration(result.data as T);
  } catch {
    // Parser/Schema 错误可能包含 secret 原文；公开失败不能透传这些诊断。
    throw new Error('配置读取或校验失败');
  }
}

/** 调用方转交独占候选；支持组合多个已校验 Document 后再发布同一不可变快照。 */
export function freezeConfiguration<T>(candidate: T): Readonly<T> {
  freezeDocument(candidate, new WeakSet());
  return candidate;
}

function freezeDocument(value: unknown, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeDocument(child, seen);
  Object.freeze(value);
}
