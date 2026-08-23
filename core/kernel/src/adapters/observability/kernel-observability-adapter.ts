import { closeLogger, getLogger } from './logger';
import { counter, histogram, startMetrics, stopMetrics } from './metrics';
import { createTraceContext, getCurrentTraceId, withTrace } from './trace-context';
import { span, startTracer, stopTracer } from './tracer';
import type {
  KernelObservabilityPort,
  KernelSpanPort,
} from '../../ports/observability.port';

export class KernelObservabilityAdapter implements KernelObservabilityPort {
  public logger(module: string) {
    return getLogger(module);
  }

  public createTraceContext(traceId?: string) {
    const context = createTraceContext(traceId ? { trace_id: traceId } : undefined);
    return { trace_id: context.trace_id };
  }

  public currentTraceId(): string | undefined {
    return getCurrentTraceId();
  }

  public withTrace<T>(traceId: string, operation: () => Promise<T>): Promise<T> {
    return withTrace(traceId, operation);
  }

  public async span<T>(
    name: string,
    operation: (spanPort: KernelSpanPort) => Promise<T>,
    attributes: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    return span(name, (handle) => operation({
      setAttribute: (key, value) => handle.setAttribute(key, value),
      setStatus: (status, message) => handle.setStatus(status, message),
    }), { ...attributes });
  }

  public histogram(name: string, value: number, labels?: Readonly<Record<string, string>>): void {
    histogram(name, value, labels ? { ...labels } : undefined);
  }

  public counter(name: string, value?: number, labels?: Readonly<Record<string, string>>): void {
    counter(name, value, labels ? { ...labels } : undefined);
  }

  public start(): void {
    startMetrics();
    startTracer();
  }

  public stop(): void {
    stopMetrics();
    stopTracer();
  }

  public async close(): Promise<void> {
    await closeLogger();
  }
}
