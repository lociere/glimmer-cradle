import type { TraceContext } from '../domain/kernel-contracts';

export interface KernelLoggerPort {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
  critical(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface KernelSpanPort {
  setAttribute(name: string, value: string | number | boolean | readonly string[]): void;
  setStatus(status: 'ok' | 'error', message?: string): void;
}

export interface KernelObservabilityPort {
  logger(module: string): KernelLoggerPort;
  createTraceContext(traceId?: string): TraceContext;
  currentTraceId(): string | undefined;
  withTrace<T>(traceId: string, operation: () => Promise<T>): Promise<T>;
  span<T>(name: string, operation: (span: KernelSpanPort) => Promise<T>, attributes?: Readonly<Record<string, unknown>>): Promise<T>;
  histogram(name: string, value: number, labels?: Readonly<Record<string, string>>): void;
  counter(name: string, value?: number, labels?: Readonly<Record<string, string>>): void;
  start(): void;
  stop(): void;
  close(): Promise<void>;
}
