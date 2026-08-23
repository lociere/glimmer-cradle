/**
 * 内核异常类（从 protocol/src/core.ts 搬入，阶段 P.5）
 *
 * 这些是 TypeScript 端 ``Error`` 子类、运行时实现 —— 跨语言无法序列化（JS Error 不可迁移）。
 * ErrorCode 枚举本身是 schema 契约（schemas/enums/ErrorCode），跨语言；这里只装类。
 */
import type { ErrorCode } from '@glimmer-cradle/protocol';

export class CoreException extends Error {
  public readonly code: ErrorCode;
  public readonly trace_id?: string;

  constructor(message: string, code: ErrorCode = 'UNKNOWN', trace_id?: string) {
    super(message);
    this.code = code;
    this.trace_id = trace_id;
    Object.setPrototypeOf(this, CoreException.prototype);
  }
}

export class ExtensionException extends CoreException {
  constructor(message: string, code: ErrorCode = 'EXTENSION_ERROR', trace_id?: string) {
    super(message, code, trace_id);
    Object.setPrototypeOf(this, ExtensionException.prototype);
  }
}
