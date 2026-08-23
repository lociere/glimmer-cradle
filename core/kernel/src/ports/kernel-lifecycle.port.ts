import type { KernelConfiguration } from './configuration.port';
import type { RuntimeReadinessCatalog, RuntimeReadinessSnapshot } from './runtime-readiness.port';

export interface KernelBootstrapPort {
  start(): Promise<Readonly<KernelConfiguration>>;
  stop(): Promise<void>;
}

export interface KernelIngressPort {
  init(config: KernelConfiguration['system']['ingress']): void;
  setSystemReady(ready: boolean): void;
  stop(): void;
}

export interface KernelTransportPort<TActionHandler = unknown> {
  start(): Promise<void>;
  stop(): Promise<void>;
  setActionHandler(handler: TActionHandler | null): void;
}

export interface RuntimeProjectionInputPort {
  replaceModuleSnapshots(moduleName: string, snapshots: readonly RuntimeReadinessSnapshot[]): void;
  clear(): void;
}

export interface RuntimeProjectionPort extends RuntimeProjectionInputPort {
  getCatalog(): RuntimeReadinessCatalog;
  subscribe(listener: (catalog: RuntimeReadinessCatalog) => void): () => void;
}

export interface CognitionIngressRecoveryPort {
  suspendIngress(summary: string): void;
  restoreIngress(): void;
}

export interface CognitionLifecycleUseCasePort {
  readonly isReady: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}
