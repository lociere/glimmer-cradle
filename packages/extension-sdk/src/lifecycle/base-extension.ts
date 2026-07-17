import type { ZodTypeAny } from 'zod';
import type { ExtensionCommandContribution } from '../manifest/index';
import type { ExtensionEventPayloadMap } from '../events/index';
import type {
  Disposable,
  ExtensionCommandHandler,
  ExtensionCommandMetadata,
  ExtensionContext,
  ExtensionLogger,
  ExtensionModule,
} from '../host/index';

/**
 * 标准扩展基类。
 *
 * 它只处理生命周期、上下文访问和资源托管；具体平台连接、感知清洗、业务逻辑都应留在扩展自己的模块里。
 */
export abstract class BaseExtension<TConfig = unknown> implements ExtensionModule<TConfig> {
  readonly configSchema: ZodTypeAny | undefined;

  private _ctx: ExtensionContext<TConfig> | null = null;

  constructor(configSchema?: ZodTypeAny) {
    this.configSchema = configSchema;
  }

  protected get logger(): ExtensionLogger {
    if (!this._ctx) throw new Error(`${this.constructor.name}: context not initialized`);
    return this._ctx.logger;
  }

  protected get config(): TConfig {
    if (!this._ctx) throw new Error(`${this.constructor.name}: context not initialized`);
    return this._ctx.config;
  }

  protected get ctx(): ExtensionContext<TConfig> {
    if (!this._ctx) throw new Error(`${this.constructor.name}: context not initialized`);
    return this._ctx;
  }

  protected subscribe<K extends keyof ExtensionEventPayloadMap>(
    eventName: K,
    handler: (payload: ExtensionEventPayloadMap[K]) => void,
  ): Disposable;
  protected subscribe(eventName: string, handler: (payload: unknown) => void): Disposable;
  protected subscribe(eventName: string, handler: (payload: unknown) => void): Disposable {
    const disposable = this.ctx.ports.events.on(eventName, handler);
    this.ctx.subscriptions.push(disposable);
    return disposable;
  }

  protected addDisposable(disposable: Disposable): Disposable {
    this.ctx.subscriptions.push(disposable);
    return disposable;
  }

  protected registerInterval(
    callback: () => void | Promise<void>,
    intervalMs: number,
  ): Disposable {
    const id = setInterval(() => {
      Promise.resolve(callback()).catch((error) => {
        this.logger.error(
          '[interval] uncaught error: ' + (error instanceof Error ? error.message : String(error)),
        );
      });
    }, intervalMs);
    return this.addDisposable({ dispose: () => clearInterval(id) });
  }

  protected registerTimeout(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): Disposable {
    const id = setTimeout(() => {
      Promise.resolve(callback()).catch((error) => {
        this.logger.error(
          '[timeout] uncaught error: ' + (error instanceof Error ? error.message : String(error)),
        );
      });
    }, delayMs);
    return this.addDisposable({ dispose: () => clearTimeout(id) });
  }

  protected registerCommand(
    commandId: string,
    handler: ExtensionCommandHandler,
    metadata?: ExtensionCommandMetadata,
  ): Disposable {
    const disposable = this.ctx.ports.commands.registerCommand(commandId, handler, metadata);
    this.ctx.subscriptions.push(disposable);
    return disposable;
  }

  protected async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    return this.ctx.ports.commands.executeCommand(commandId, ...args);
  }

  protected async listCommands(): Promise<ExtensionCommandContribution[]> {
    return this.ctx.ports.commands.listCommands();
  }

  async onActivate(ctx: ExtensionContext<TConfig>): Promise<void> {
    this._ctx = ctx;
    await this.activate();
  }

  async onDeactivate(): Promise<void> {
    try {
      await this.deactivate();
    } finally {
      this._ctx = null;
    }
  }

  protected abstract activate(): Promise<void> | void;

  protected async deactivate(): Promise<void> {}
}
