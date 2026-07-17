/**
 * IPC通信服务端
 * Kernel 内核与 Cognition 认知核通信的唯一入口
 * 负责消息的接收、校验、处理、响应
 */
import * as zmq from "zeromq";
import { IPCMessageType, IPCRequest, IPCResponse, createSuccessResponse, createErrorResponse, ErrorCode, createIPCRequest, normalizeReplyMessages } from '@glimmer-cradle/protocol';
import { StateSyncEvent, ChannelReplyEvent } from '../../foundation/event-bus/events';
import { CoreException } from '../../foundation/exceptions';
import { createTraceContext } from '../../foundation/logger/trace-context';
import { ConfigManager } from "../../foundation/config/config-manager";
import { getLogger } from "../../foundation/logger/logger";
import { EventBus } from "../../foundation/event-bus/event-bus";
import { EndpointRegistry } from '../../foundation/endpoints/endpoint-registry';

const logger = getLogger("ipc-server");

const TRAFFIC_LOG_TYPES = new Set<IPCMessageType>([
  IPCMessageType.CONFIG_INIT,
  IPCMessageType.KNOWLEDGE_INIT,
  IPCMessageType.PERCEPTION_MESSAGE,
]);

const NO_REPLY_TYPES = new Set<IPCMessageType>([
  IPCMessageType.STATE_SYNC,
  IPCMessageType.LOG,
  IPCMessageType.ACTION_COMMAND,
]);

/**
 * IPC请求处理器类型
 */
type IPCRequestHandler = (request: IPCRequest) => Promise<IPCResponse>;

/**
 * IPC通信服务端
 * 单例模式
 */
export class IPCServer {
  private static _instance: IPCServer | null = null;
  private _routerSocket: zmq.Router | null = null;
  private _bindAddress: string | null = null;
  private _lastClientId: Buffer | null = null;
  private _isRunning: boolean = false;
  private _requestHandlers: Map<IPCMessageType, IPCRequestHandler> = new Map();
  private _messageHandler: (() => Promise<void>) | null = null;
  private readonly _handlerTasks = new Set<Promise<void>>();
  private _routerSendChain: Promise<void> = Promise.resolve();
  
  // 存储发出的请求，用于等待响应 (trace_id -> resolver)
  private _pendingRequests: Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void; timer: NodeJS.Timeout }
  > = new Map();

  /** Cognition 认知核是否已建立首次 IPC 连接（收到至少一条消息）*/
  public get isClientConnected(): boolean {
    return this._lastClientId !== null;
  }

  public get bindAddress(): string {
    if (!this._bindAddress) throw new Error('IPCServer 尚未绑定端点');
    return this._bindAddress;
  }

  /**
   * 获取单例实例
   */
  public static get instance(): IPCServer {
    if (!IPCServer._instance) {
      IPCServer._instance = new IPCServer();
    }
    return IPCServer._instance;
  }

  private constructor() {}

  private shouldLogTraffic(messageType: IPCMessageType): boolean {
    return TRAFFIC_LOG_TYPES.has(messageType);
  }

  /**
   * 启动IPC服务端
   */
  public async start(): Promise<void> {
    if (this._isRunning) {
      logger.warn("IPC服务端已在运行，跳过重复启动");
      return;
    }

    const config = ConfigManager.instance.getConfig();
    // Ensure bind address doesn't contain stray whitespace or line endings.
    let bindAddress = (config.system.ipc.bind_address || "").toString().trim();

    if (!/^tcp:\/\/127\.0\.0\.1:(?:\d+|\*)$/.test(bindAddress)) {
      throw new CoreException(
        `IPC bind_address 必须使用回环动态端点: ${bindAddress}`,
        ErrorCode.IPC_ERROR,
      );
    }

    logger.info("开始启动IPC服务端", { bind_address: bindAddress });

    try {
      // 创建Router套接字（处理请求/响应）
      this._routerSocket = new zmq.Router();
      await this._routerSocket.bind(bindAddress);
      this._bindAddress = this._routerSocket.lastEndpoint;
      if (!this._bindAddress) {
        throw new CoreException('ZeroMQ 未返回实际绑定端点', ErrorCode.IPC_ERROR);
      }
      await EndpointRegistry.instance.publish('cognition-rpc', this._bindAddress);
      logger.debug("Router套接字绑定成功", { bind_address: this._bindAddress });

      // 注册默认处理器
      this.registerDefaultHandlers();

      // 启动消息循环
      this._isRunning = true;
      this.startMessageLoop();

      logger.info("IPC服务端启动成功", { bind_address: this._bindAddress });
    } catch (error) {
      logger.error("IPC服务端启动失败", { error: (error as Error).message });
      throw new CoreException(`IPC服务端启动失败: ${(error as Error).message}`, ErrorCode.IPC_ERROR);
    }
  }

  /**
   * 注册默认请求处理器
   */
  private registerDefaultHandlers(): void {
    // 心跳处理器
    this.registerHandler(IPCMessageType.LIFE_HEARTBEAT, async (request) => {
      return createSuccessResponse(
        IPCMessageType.SUCCESS_RESPONSE,
        request.trace_id,
        { timestamp: new Date().toISOString() }
      );
    });

    // 日志事件处理器
    this.registerHandler(IPCMessageType.LOG, async (request) => {
      const logData = request.payload;
      logger.log(logData.level, logData.message, {
        ...logData.extra,
        trace_id: request.trace_id,
        from: "python-cognition",
      });
      return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
    });

    // 状态同步事件处理器
    this.registerHandler(IPCMessageType.STATE_SYNC, async (request) => {
      const state = request.payload?.state ?? (request as any).state;
      await EventBus.instance.publish(
        new StateSyncEvent({ state }, createTraceContext({ trace_id: request.trace_id }))
      );
      return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
    });

    // 自主输出：CognitiveLoop 主动推送的 ActionCommand（阶段 7.4）。
    // Kernel 在这里把 reply 规范化为 ChannelReplyPayload，再交给桌面或平台适配器。
    this.registerHandler(IPCMessageType.ACTION_COMMAND, async (request) => {
      const cmd = request.payload ?? {};
      const traceId = cmd.trace_id || request.trace_id;
      if (cmd.action_type === 'reply') {
        const text = cmd.payload?.text;
        if (typeof text === 'string' && text.trim()) {
          const messages = normalizeReplyMessages(text, cmd.payload?.messages);
          // 阶段 8.2：回复必须显式携带目标 scene_id。缺目标时直接丢弃，
          // 不让扩展或桌面端用 traceId 猜路由。
          const targetChannel = typeof cmd.target?.scene_id === 'string'
            ? cmd.target.scene_id
            : undefined;
          if (!targetChannel) {
            logger.warn("ActionCommand 缺少 target.scene_id，已丢弃 reply", { trace_id: traceId });
            return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
          }
          await EventBus.instance.publish(
            new ChannelReplyEvent(
              {
                trace_id: traceId,
                text,
                messages,
                emotion_state: cmd.emotion_state,
                target_channel: targetChannel,
              },
              createTraceContext({ trace_id: traceId }),
            )
          );
        }
      }
      // noop / recall / react / 空 text → 沉默或暂不处理（留后续渲染批次）
      return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
    });
  }

  /**
   * 注册请求处理器
   */
  public registerHandler(messageType: IPCMessageType, handler: IPCRequestHandler): void {
    this._requestHandlers.set(messageType, handler);
  }

  public unregisterHandler(messageType: IPCMessageType): void {
    this._requestHandlers.delete(messageType);
  }

  /**
   * 启动消息循环，处理客户端请求
   */
  private startMessageLoop(): void {
    if (!this._routerSocket || !this._isRunning) {
      return;
    }

    this._messageHandler = async () => {
      if (!this._routerSocket || !this._isRunning) {
        return;
      }

      try {
        // 接收消息：
        // - DEALER -> ROUTER 常见为 [clientId, message]
        // - 某些客户端可能携带空分隔帧 [clientId, empty, message]
        const frames = await this._routerSocket.receive();
        const clientId = frames[0];
        const messageBuffer = frames.length >= 3 ? frames[2] : frames[1];
        if (!clientId || !messageBuffer) {
          throw new CoreException("IPC消息帧格式非法", ErrorCode.IPC_ERROR);
        }
        // 记录最新连接的客户端 id，用于内核主动向 Python 发送请求
        this._lastClientId = clientId;
        const messageStr = messageBuffer.toString("utf-8");
        const request: IPCRequest = JSON.parse(messageStr);

        if (this.shouldLogTraffic(request.type)) {
          logger.info("收到IPC业务消息", {
            trace_id: request.trace_id,
            message_type: request.type,
            client_id: clientId.toString("hex"),
          });
        }

        // RPC 响应必须在接收循环内立即关联，不能等待当前入站 handler 完成。
        if (
          request.type === IPCMessageType.SUCCESS_RESPONSE ||
          request.type === IPCMessageType.ERROR_RESPONSE
        ) {
          const pending = this._pendingRequests.get(request.trace_id);
          if (pending) {
            if (request.type === IPCMessageType.SUCCESS_RESPONSE) {
              pending.resolve(request.payload);
            } else {
              const errorInfo = (request as any).error ?? { message: "Unknown Error", code: "UNKNOWN" };
              pending.reject(new CoreException(errorInfo.message, errorInfo.code));
            }
            this._pendingRequests.delete(request.trace_id);
          }
        } else {
          this.dispatchIncomingRequest(clientId, request);
        }
      } catch (error) {
        if (this._isRunning) {
          logger.error("IPC消息处理异常", { error: (error as Error).message });
        }
      }

      // 继续循环
      if (this._isRunning) {
        setImmediate(this._messageHandler!);
      }
    };

    // 启动消息循环
    setImmediate(this._messageHandler);
  }

  private dispatchIncomingRequest(clientId: Buffer, request: IPCRequest): void {
    const task = this.handleIncomingRequest(clientId, request)
      .catch((error) => {
        if (this._isRunning) {
          logger.error("IPC并发请求任务异常", {
            message_type: request.type,
            trace_id: request.trace_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => this._handlerTasks.delete(task));
    this._handlerTasks.add(task);
  }

  private async handleIncomingRequest(clientId: Buffer, request: IPCRequest): Promise<void> {
    const handler = this._requestHandlers.get(request.type);
    let response: IPCResponse;

    if (!handler) {
      logger.warn("未找到IPC请求处理器", { message_type: request.type, trace_id: request.trace_id });
      response = createErrorResponse(
        IPCMessageType.ERROR_RESPONSE,
        request.trace_id,
        ErrorCode.IPC_ERROR,
        `未找到消息类型 ${request.type} 的处理器`,
      );
    } else {
      try {
        response = await handler(request);
      } catch (error) {
        logger.error("IPC请求处理器执行异常", {
          message_type: request.type,
          trace_id: request.trace_id,
          error: (error as Error).message,
        });
        response = createErrorResponse(
          IPCMessageType.ERROR_RESPONSE,
          request.trace_id,
          (error as CoreException).code || ErrorCode.IPC_ERROR,
          (error as Error).message,
        );
      }
    }

    if (NO_REPLY_TYPES.has(request.type) || !this._isRunning || !this._routerSocket) {
      return;
    }

    await this.enqueueRouterSend([clientId, Buffer.from(JSON.stringify(response), "utf-8")]);
    if (this.shouldLogTraffic(request.type)) {
      logger.info("IPC业务响应发送完成", {
        trace_id: request.trace_id,
        message_type: request.type,
        success: response.success,
      });
    }
  }

  private enqueueRouterSend(frames: Buffer[]): Promise<void> {
    const socket = this._routerSocket;
    if (!socket || !this._isRunning) {
      return Promise.reject(new CoreException("IPC服务端未运行，无法发送消息", ErrorCode.IPC_ERROR));
    }
    const send = this._routerSendChain.then(async () => {
      await socket.send(frames);
    });
    this._routerSendChain = send.catch(() => undefined);
    return send;
  }

  /**
   * 向 Cognition 认知核发送请求并等待响应（pull-based RPC）。
   * 使用 pendingRequests 字典按 trace_id 关联，天然支持并发。
   */
  public async sendRequest<T = any>(
    type: IPCMessageType,
    payload: any = {},
    timeoutMs: number = 30000,
    trace?: { trace_id?: string; span_id?: string },
  ): Promise<T> {
    if (!this._routerSocket || !this._isRunning || !this._lastClientId) {
      throw new CoreException("IPC服务端未运行或未连接客户端，无法发送请求", ErrorCode.IPC_ERROR);
    }

    // 上游已经建立 trace/span 时必须沿用；这里仅在系统自发 RPC 缺失上下文时兜底生成。
    const traceId = trace?.trace_id || createTraceContext().trace_id;
    const request = createIPCRequest(type, traceId, payload, trace?.span_id);

    if (this.shouldLogTraffic(type)) {
      logger.info("发送IPC业务请求", {
        trace_id: traceId,
        message_type: type,
      });
    }

    return new Promise<T>((resolve, reject) => {
      // 设置超时定时器
      const timer = setTimeout(() => {
        if (this._pendingRequests.has(traceId)) {
          this._pendingRequests.delete(traceId);
          reject(new CoreException(`IPC请求超时 (${timeoutMs}ms)`, ErrorCode.IPC_TIMEOUT));
        }
      }, timeoutMs);

      // 注册 pending request
      this._pendingRequests.set(traceId, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      // 发送消息
      // RPC 协调器直接使用 ROUTER socket 发送，并以 trace_id 关联响应。
      try {
        const buffer = Buffer.from(JSON.stringify(request), "utf-8");
        this.enqueueRouterSend([this._lastClientId!, buffer]).catch((err) => {
          this._pendingRequests.get(traceId)?.reject(err);
          this._pendingRequests.delete(traceId);
        });
      } catch (error) {
        this._pendingRequests.get(traceId)?.reject(error);
        this._pendingRequests.delete(traceId);
      }
    });
  }

  /**
   * 停止IPC服务端，优雅停机
   */
  public async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    logger.info("IPC服务端开始停止");
    this._isRunning = false;
    this._messageHandler = null;

    const shutdownError = new CoreException("IPC服务端已停止", ErrorCode.IPC_ERROR);
    for (const pending of this._pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(shutdownError);
    }
    this._pendingRequests.clear();

    // 关闭套接字
    if (this._routerSocket) {
      this._routerSocket.close();
      this._routerSocket = null;
    }
    this._bindAddress = null;
    await EndpointRegistry.instance.revoke('cognition-rpc');

    // 清空处理器
    this._requestHandlers.clear();
    this._lastClientId = null;
    this._routerSendChain = Promise.resolve();
    logger.info("IPC服务端停止完成");
  }
}
