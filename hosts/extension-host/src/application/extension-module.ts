export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface ExtensionLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface ExtensionHostContext<TConfig = Record<string, unknown>> {
  readonly extensionId: string;
  readonly activationProfile: string;
  readonly logger: ExtensionLogger;
  readonly config: TConfig;
  readonly subscriptions: Disposable[];
  readonly ports: Record<string, any>;
}

export interface LoadedExtensionModule {
  configSchema?: {
    safeParse(input: unknown):
      | { success: true; data: unknown }
      | {
          success: false;
          error: { issues?: Array<{ path?: Array<string | number>; message: string }> };
        };
  };
  onActivate(ctx: ExtensionHostContext): Promise<void> | void;
  onDeactivate?(): Promise<void> | void;
}

export interface DisposableRegistry {
  add(disposable: Disposable): Disposable;
  disposeAll(): Promise<void>;
  size(): number;
}

export function createDisposableRegistry(): DisposableRegistry {
  const disposables: Disposable[] = [];
  return {
    add(disposable) {
      disposables.push(disposable);
      return disposable;
    },
    async disposeAll() {
      for (const disposable of [...disposables].reverse()) {
        await Promise.resolve(disposable.dispose()).catch(() => undefined);
      }
      disposables.length = 0;
    },
    size() {
      return disposables.length;
    },
  };
}
