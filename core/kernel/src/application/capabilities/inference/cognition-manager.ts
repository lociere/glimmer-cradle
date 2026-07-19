/**
 * Cognition 认知核管理器
 * 负责认知核 Python 子进程的启动、停止、生命周期管理、配置注入。
 * 是 Kernel 内核与 Cognition 认知核交互的唯一入口。
 */
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs-extra";
import {
  IPCMessageType,
  IPCRequest,
  IPCResponse,
  ChatMessageResponse,
  LifeHeartbeatRequest,
  LifeHeartbeatResponse,
  AgentPlanRequest,
  AgentPlanResponse,
  AgentSynthesisRequest,
  AgentSynthesisResponse,
  ConversationHistoryIPCRequest,
  ConversationHistoryResponse,
  PerceptionCancelRequest,
  PerceptionEvent,
  createIPCRequest,
  ErrorCode,
  KnowledgeInitPayload,
} from '@glimmer-cradle/protocol';
import { CoreException } from '../../../foundation/exceptions';
import { createTraceContext, getCurrentSpanId } from '../../../foundation/logger/trace-context';
import { ConfigManager } from "../../../foundation/config/config-manager";
import { IPCServer } from "../../../infrastructure/ipc-broker/ipc-server";
import { getLogger } from "../../../foundation/logger/logger";
import { resolveRepoRoot, resolveLogDir, resolveObservabilityDir } from "../../../foundation/utils/path-utils";
import {
  forceTerminateManagedProcessTree,
  stopManagedProcess,
  waitForManagedProcessExit,
} from '../../../foundation/process/process-supervisor';

const logger = getLogger("cognition-manager");
const COGNITION_PROCESS_LOG = "cognition.console.log";
let cognitionProcessLogDir = path.join(resolveLogDir(), "application");

function setCognitionProcessLogRoot(logDir: string): void {
  cognitionProcessLogDir = path.join(logDir, "application");
}

function appendCognitionProcessLog(record: Record<string, unknown>): void {
  const line = JSON.stringify(record, undefined, 0);
  fs.ensureDir(cognitionProcessLogDir)
    .then(() => fs.appendFile(path.join(cognitionProcessLogDir, COGNITION_PROCESS_LOG), `${line}\n`, "utf8"))
    .catch((error) => {
      // 不能再走 logger，避免日志 sink 自身失败时递归写日志。
      console.error("写入 Cognition 子进程日志失败", error);
    });
}

function classifyCognitionProcessLine(line: string, fromStderr: boolean): "debug" | "info" | "warn" | "error" {
  const normalized = line.replace(/\x1b\[[0-9;]*m/g, "").toLowerCase();
  if (/traceback|exception|fatal|critical|error:/.test(normalized)) return "error";
  if (/warning|warn/.test(normalized)) return "warn";
  if (/building|built|downloading|downloaded|installed|uninstalled|resolved|prepared|audited|uv |sentence-transformers|transformers|torch|pillow|modelscope/.test(normalized)) {
    return "debug";
  }
  return fromStderr ? "info" : "debug";
}

/**
 * 解析 Cognition 认知核输出的单行日志并路由到 TS logger。
 *
 * 支持两种格式：
 *   1. 纯 JSON（structlog ProcessorFormatter → stdout）：
 *      {"level":"info","event":"...","module":"...","timestamp":"..."}
 *   2. stdlib logging 前缀格式（date prefix + JSON，通常来自 stderr）：
 *      "2026-01-01 12:00:00,000 [INFO] {"event":"...","level":"info",...}"
 *
 * 对于无法解析的非 JSON 行（如 Traceback 纯文本），视为 error 级别直接输出。
 */
// 匹配 Python stdlib logging 的 "DATE TIME,ms [LEVEL] " 前缀
const PYTHON_STDLIB_LOG_PREFIX_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \[(\w+)\] /;

function routePythonLogLine(line: string, fromStderr = false): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  // 尝试剥离 "DATE TIME [LEVEL] " 前缀（Python stdlib logging 格式）
  const prefixMatch = PYTHON_STDLIB_LOG_PREFIX_RE.exec(trimmed);
  const stdlibLevel = prefixMatch ? prefixMatch[1].toLowerCase() : null;
  const jsonStr = prefixMatch ? trimmed.slice(prefixMatch[0].length) : trimmed;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    const processLevel = classifyCognitionProcessLine(trimmed, fromStderr);
    appendCognitionProcessLog({
      timestamp: new Date().toISOString(),
      level: processLevel,
      source: "cognition",
      stream: fromStderr ? "stderr" : "stdout",
      message: trimmed,
    });

    // 无法解析为 JSON：只有明显错误才摘要进入 Kernel 主时间线。
    if (processLevel === "error") {
      logger.error("Cognition 子进程输出了非结构化错误", {
        source: "cognition",
        stream: fromStderr ? "stderr" : "stdout",
        message_excerpt: trimmed.slice(0, 240),
      });
    }
    return;
  }

  // 优先使用 structlog 输出的 level 字段，fallback 到 stdlib prefix 中解析出的等级
  const level = String(parsed.level ?? stdlibLevel ?? "info").toLowerCase();
  const event = String(parsed.event ?? "");
  const childModule = typeof parsed.module === "string" ? parsed.module : undefined;
  const childTimestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
  // 透传其余业务字段（排除已提取的字段）
  const { level: _l, event: _e, module: _m, timestamp: _t, logger: _lg, ...rest } = parsed;

  appendCognitionProcessLog({
    timestamp: childTimestamp ?? new Date().toISOString(),
    level,
    source: "cognition",
    stream: fromStderr ? "stderr" : "stdout",
    module: childModule,
    message: event,
    ...rest,
  });

  const meta: Record<string, unknown> = {
    source: "cognition",
    child_module: childModule,
    child_event: event,
  };
  if (childTimestamp) meta.child_timestamp = childTimestamp;
  const traceId = rest.trace_id;
  if (traceId) meta.trace_id = traceId;
  const bootId = rest.boot_id;
  if (bootId) meta.boot_id = bootId;

  switch (level) {
    case "warning":
    case "warn":
      logger.warn("Cognition 子进程告警", meta);
      break;
    case "error":
    case "critical":
      logger.error("Cognition 子进程错误", meta);
      break;
    case "debug":
    default:
      // info/debug 是 Cognition 自己的内部时间线，已写入
      // Cognition console 时间线独立落盘；Kernel 主日志只记录中枢观察到的状态。
      break;
  }
}

/**
 * Cognition 认知核管理器
 * 单例模式
 */
export class CognitionManager {
  private static _instance: CognitionManager | null = null;
  private _pythonProcess: ChildProcess | null = null;
  private _isRunning: boolean = false;
  private _isReady: boolean = false;
  private _requestTimeoutMs: number = 30000;
  /** 逐行缓冲：子进程 data 事件可能携带不完整行 */
  private _stdoutLineBuffer: string = "";
  private _stderrLineBuffer: string = "";
  /** 标记是否为主动停止，避免 exit 事件误触自动重启 */
  private _stoppingIntentionally: boolean = false;
  private _lastExitKind: "normal" | "console_interrupt" | "unexpected" | null = null;

  /**
   * 获取单例实例
   */
  public static get instance(): CognitionManager {
    if (!CognitionManager._instance) {
      CognitionManager._instance = new CognitionManager();
    }
    return CognitionManager._instance;
  }

  private constructor() {}

  /**
   * 启动 Cognition 认知核子进程，初始化配置。
   */
  public async start(): Promise<void> {
    if (this._isRunning) {
      logger.warn("Cognition 认知核已在运行，跳过重复启动");
      return;
    }

    logger.info("Cognition 认知核启动：创建子进程");
    this._lastExitKind = null;
    const config = ConfigManager.instance.getConfig();
    const dashScopeSecrets = await ConfigManager.instance.loadDashScopeSecretEnvironment();
    this._requestTimeoutMs = config.system.ipc.request_timeout_ms;
    setCognitionProcessLogRoot(resolveLogDir());

    try {
      // 冻结核心配置，防止运行时修改
      ConfigManager.instance.freezeCoreConfig();

      const repoRoot = resolveRepoRoot();

      const cognitionDir = path.resolve(repoRoot, "core", "cognition");
      const uvCommand = process.platform === "win32" ? "uv.exe" : "uv";
      const uvArgs = ["run", "--project", cognitionDir, "glimmer-cradle-cognition"];

      logger.debug("Cognition 认知核运行命令已解析", {
        command: uvCommand,
        project: cognitionDir,
      });

      this._pythonProcess = spawn(uvCommand, uvArgs, {
        cwd: repoRoot,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          ...dashScopeSecrets,
          GLIMMER_CRADLE_IPC_BIND_ADDRESS: IPCServer.instance.bindAddress,
          GLIMMER_CRADLE_CONFIG: JSON.stringify({
            ...config.character,
            memory: config.system.memory,
            embedding: config.system.embedding,
          }),
          GLIMMER_CRADLE_OBSERVABILITY: JSON.stringify(config.system.observability),
          GLIMMER_CRADLE_OBSERVABILITY_DIR: resolveObservabilityDir(),
          LOG_DIR: resolveLogDir(),
          PYTHONUNBUFFERED: "1",
        },
        // 将 stdin 也设为 pipe 避免 Windows 下 inherit 导致 stdout 被路由到控制台
        stdio: ["pipe", "pipe", "pipe"],
      });

      this._pythonProcess.stdout?.on("data", (data: Buffer) => {
        this._stdoutLineBuffer += data.toString("utf-8");
        const lines = this._stdoutLineBuffer.split("\n");
        this._stdoutLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          routePythonLogLine(line, false);
        }
      });

      // stderr 同样使用 routePythonLogLine 解析，兼容 Python 日志写到 stderr 的情况
      // 真实的 Traceback / 非结构化错误仍会被识别并路由为 error 级别
      this._pythonProcess.stderr?.on("data", (data: Buffer) => {
        this._stderrLineBuffer += data.toString("utf-8");
        const lines = this._stderrLineBuffer.split("\n");
        this._stderrLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          routePythonLogLine(line, true);
        }
      });

      this._pythonProcess.on("exit", (code, signal) => {
        // 进程退出时刷新两路缓冲中的残余内容
        if (this._stdoutLineBuffer.trim()) {
          routePythonLogLine(this._stdoutLineBuffer, false);
          this._stdoutLineBuffer = "";
        }
        if (this._stderrLineBuffer.trim()) {
          routePythonLogLine(this._stderrLineBuffer, true);
          this._stderrLineBuffer = "";
        }
        const interrupted = code === 0xC000013A;
        const exitKind = interrupted ? "console_interrupt" : code === 0 ? "normal" : "unexpected";
        const intentional = this._stoppingIntentionally || code === 0 || interrupted;
        this._lastExitKind = exitKind;
        const exitMeta = {
          code,
          signal,
          exit_kind: exitKind,
        };
        if (interrupted || code === 0) {
          logger.info("Cognition 认知核进程退出", exitMeta);
        } else {
          logger.warn("Cognition 认知核进程退出", exitMeta);
        }
        this._isRunning = false;
        this._isReady = false;

        if (!intentional && code !== 0) {
          logger.error("Cognition 认知核异常退出，正在自动重启");
          this.restart().catch(() => {
            logger.error("自动重启失败");
          });
        }
      });

      this._pythonProcess.on("error", (error) => {
        logger.error("Cognition 认知核进程启动失败", { error: error.message });
        this._isRunning = false;
        this._isReady = false;
      });

      this._isRunning = true;

      await this.waitForReady();
      await this.initAIConfig();
      await this.initKnowledge();

      this._isReady = true;
      logger.info("Cognition 认知核已就绪", {
        startup_stage: "ready",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this._lastExitKind === "console_interrupt") {
        logger.warn("Cognition 认知核启动被外部中断", { error: message });
      } else {
        logger.error("Cognition 认知核启动失败", { error: message });
      }
      await this.stop();
      throw error;
    }
  }

  /**
   * 等待 Cognition 认知核真正就绪：不仅是进程启动（PID 存在），
   * 而是等待 ZMQ DEALER 连接建立并收到第一条 IPC 消息（_lastClientId 非空）。
   * 只有这样，后续的 initAIConfig / initKnowledge 才不会因
   * "未连接客户端" 而失败。
   */
  private async waitForReady(): Promise<void> {
    const maxWaitMs = 20 * 60_000;
    const pollIntervalMs = 300;
    const startAt = Date.now();

    logger.info("Cognition 认知核启动：等待模型准备与 IPC 握手");

    return new Promise((resolve, reject) => {
      const check = () => {
        // 进程意外退出或启动失败：快速失败，避免等满超时
        if (!this._pythonProcess || this._pythonProcess.killed || !this._isRunning) {
          if (this._lastExitKind === "console_interrupt") {
            return reject(new CoreException("Cognition 认知核启动被外部中断", ErrorCode.INFERENCE_ERROR));
          }
          return reject(new CoreException("Python 进程意外退出", ErrorCode.INFERENCE_ERROR));
        }

        // 最终检查：IPCServer 已收到来自 Python 的首条消息（_lastClientId 已设置）
        if (IPCServer.instance.isClientConnected) {
          logger.info("Cognition 认知核启动：IPC 握手完成", {
            waited_ms: Date.now() - startAt,
          });
          return resolve();
        }

        if (Date.now() - startAt >= maxWaitMs) {
          return reject(new CoreException(
            `等待 Cognition 认知核模型准备与 IPC 连接超时（>${maxWaitMs}ms）`,
            ErrorCode.INFERENCE_ERROR
          ));
        }

        setTimeout(check, pollIntervalMs);
      };

      // 延迟一个 tick 开始轮询，让进程有机会 spawn
      setTimeout(check, pollIntervalMs);
    });
  }

  private async initAIConfig(): Promise<void> {
    logger.info("Cognition 认知核启动：注入配置");
    const config = ConfigManager.instance.getConfig();

    const traceContext = createTraceContext();
    const request = createIPCRequest(
      IPCMessageType.CONFIG_INIT,
      traceContext.trace_id,
      { config: config.character }
    );

    await this.sendRequest(request);
    logger.info("Cognition 认知核启动：配置注入完成");
  }

  private async initKnowledge(): Promise<void> {
    logger.info("Cognition 认知核启动：注入知识库");
    const knowledgeBaseConfig = await ConfigManager.instance.loadKnowledgeBaseConfig();
    // KnowledgeBaseConfig（配置 schema）→ KnowledgeInitPayload（IPC schema）。
    // 两端都只允许 scope=knowledge，角色人格不走知识库初始化链路。
    // 用 unknown 中转转型，避免 TS 因命名类型差异误报。
    const payload: KnowledgeInitPayload = {
      knowledge_base: {
        version: knowledgeBaseConfig.version,
        retrieval: knowledgeBaseConfig.retrieval as unknown as KnowledgeInitPayload['knowledge_base']['retrieval'],
        entries: knowledgeBaseConfig.entries as unknown as KnowledgeInitPayload['knowledge_base']['entries'],
      },
    };

    const traceContext = createTraceContext();
    const request = createIPCRequest(
      IPCMessageType.KNOWLEDGE_INIT,
      traceContext.trace_id,
      payload
    );

    await this.sendRequest(request);
    logger.info("Cognition 认知核启动：知识库注入完成", {
      knowledge_version: knowledgeBaseConfig.version,
      knowledge_entry_count: knowledgeBaseConfig.entries.length,
    });
  }

  /**
   * 向 Cognition 认知核发送请求并等待响应。
   * 委托给 IPCServer.sendRequest() 统一处理 RPC 协调（trace_id 关联、超时、并发安全）。
   */
  private async sendRequest(request: IPCRequest, timeoutMs = this._requestTimeoutMs): Promise<IPCResponse> {
    if (!this._isRunning || !this._pythonProcess) {
      throw new CoreException("Cognition 认知核未运行", ErrorCode.INFERENCE_ERROR);
    }

    // 使用 IPCServer 的 pendingRequests 机制处理并发安全的 RPC 调用
    const data = await IPCServer.instance.sendRequest<any>(
      request.type,
      request.payload,
      timeoutMs,
      {
        trace_id: request.trace_id,
        span_id: request.span_id ?? getCurrentSpanId(),
      },
    );

    // 将 RPC payload 包装为统一 IPCResponse。
    return {
      type: IPCMessageType.SUCCESS_RESPONSE,
      trace_id: request.trace_id,
      success: true,
      payload: data,
    };
  }

  public async sendPerceptionMessage(request: PerceptionEvent, traceId?: string): Promise<ChatMessageResponse> {
    if (!this._isReady) {
      throw new CoreException("Cognition 认知核未就绪", ErrorCode.INFERENCE_ERROR);
    }

    const traceContext = createTraceContext({ trace_id: traceId });
    const ipcRequest = createIPCRequest(
      IPCMessageType.PERCEPTION_MESSAGE,
      traceContext.trace_id,
      request
    );

    const response = await this.sendRequest(ipcRequest);
    if (!response.success) {
      throw new CoreException(
        `AI生成失败: ${response.error?.message}`,
        response.error?.code as ErrorCode || ErrorCode.INFERENCE_ERROR,
        traceContext.trace_id
      );
    }

    return response.payload as ChatMessageResponse;
  }

  public async cancelPerception(request: PerceptionCancelRequest): Promise<void> {
    if (!this._isReady) {
      return;
    }

    const traceContext = createTraceContext();
    const ipcRequest = createIPCRequest(
      IPCMessageType.PERCEPTION_CANCEL,
      traceContext.trace_id,
      request
    );

    await IPCServer.instance.sendRequest(
      ipcRequest.type,
      ipcRequest.payload,
      this._requestTimeoutMs,
      { trace_id: ipcRequest.trace_id },
    );
  }

  public async sendAgentPlan(request: AgentPlanRequest, traceId?: string): Promise<AgentPlanResponse> {
    if (!this._isReady) {
      throw new CoreException("Cognition 认知核未就绪", ErrorCode.INFERENCE_ERROR);
    }

    const traceContext = createTraceContext({ trace_id: traceId });
    const ipcRequest = createIPCRequest(
      IPCMessageType.AGENT_PLAN,
      traceContext.trace_id,
      request
    );

    const response = await this.sendRequest(ipcRequest);
    if (!response.success) {
      throw new CoreException(
        `Agent规划失败: ${response.error?.message}`,
        response.error?.code as ErrorCode || ErrorCode.INFERENCE_ERROR,
        traceContext.trace_id
      );
    }

    return response.payload as AgentPlanResponse;
  }

  public async sendAgentSynthesis(request: AgentSynthesisRequest): Promise<AgentSynthesisResponse> {
    if (!this._isReady) {
      throw new CoreException("Cognition 认知核未就绪", ErrorCode.INFERENCE_ERROR);
    }

    const traceContext = createTraceContext({ trace_id: request.trace_id });
    const ipcRequest = createIPCRequest(
      IPCMessageType.AGENT_SYNTHESIS,
      traceContext.trace_id,
      {
        original_goal: request.original_goal,
        scene_id: request.scene_id ?? 'default',
        tool_results: request.tool_results,
      }
    );

    const response = await this.sendRequest(ipcRequest);
    if (!response.success) {
      throw new CoreException(
        `Agent合成失败: ${response.error?.message}`,
        response.error?.code as ErrorCode || ErrorCode.INFERENCE_ERROR,
        traceContext.trace_id
      );
    }

    return response.payload as AgentSynthesisResponse;
  }

  public async sendLifeHeartbeat(request: LifeHeartbeatRequest): Promise<LifeHeartbeatResponse> {
    if (!this._isReady) {
      throw new CoreException("Cognition 认知核未就绪", ErrorCode.INFERENCE_ERROR);
    }

    const traceContext = createTraceContext();
    const ipcRequest = createIPCRequest(
      IPCMessageType.LIFE_HEARTBEAT,
      traceContext.trace_id,
      request
    );

    const response = await this.sendRequest(ipcRequest);
    if (!response.success) {
      logger.warn("生命心跳发送失败", { error: response.error?.message });
      throw new CoreException(`生命心跳失败: ${response.error?.message}`, ErrorCode.INFERENCE_ERROR);
    }

    return response.payload as LifeHeartbeatResponse;
  }

  public async getConversationHistory(
    request: ConversationHistoryIPCRequest,
    traceId?: string,
  ): Promise<ConversationHistoryResponse> {
    if (!this._isReady) {
      throw new CoreException("Cognition 认知核未就绪", ErrorCode.INFERENCE_ERROR);
    }

    const traceContext = createTraceContext({ trace_id: traceId });
    const ipcRequest = createIPCRequest(
      IPCMessageType.CONVERSATION_HISTORY,
      traceContext.trace_id,
      request,
    );

    const response = await this.sendRequest(ipcRequest);
    if (!response.success) {
      throw new CoreException(
        `Conversation 历史查询失败: ${response.error?.message}`,
        response.error?.code as ErrorCode || ErrorCode.INFERENCE_ERROR,
        traceContext.trace_id,
      );
    }

    return response.payload as ConversationHistoryResponse;
  }

  public async restart(): Promise<void> {
    logger.info("开始重启 Cognition 认知核");
    await this.stop();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this.start();
    logger.info("Cognition 认知核重启完成");
  }

  public async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    logger.info("Cognition 认知核开始停止");
    this._stoppingIntentionally = true;
    this._isReady = false;
    const child = this._pythonProcess;
    let shutdownAccepted = false;

    if (child && IPCServer.instance.isClientConnected) {
      try {
        const traceContext = createTraceContext();
        const request = createIPCRequest(
          IPCMessageType.COGNITION_SHUTDOWN,
          traceContext.trace_id,
          { reason: 'kernel_lifecycle_stop' },
          traceContext.span_id ?? undefined,
        );
        await this.sendRequest(request, 1000);
        shutdownAccepted = true;
        logger.info("Cognition 已确认协议级停机请求");
      } catch (error) {
        logger.warn("Cognition 协议级停机请求失败，转入受管进程回收", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (child && shutdownAccepted) {
      if (!await waitForManagedProcessExit(child, 2500)) {
        await forceTerminateManagedProcessTree(
          child,
          'Cognition 认知核',
          1000,
          process.platform !== 'win32',
        );
      }
    } else {
      await stopManagedProcess(child, {
        label: 'Cognition 认知核',
        gracefulTimeoutMs: 2500,
        forceTimeoutMs: 1000,
        ownsProcessGroup: process.platform !== 'win32',
      });
    }

    this._isRunning = false;
    this._pythonProcess = null;
    this._stoppingIntentionally = false;
    logger.info("Cognition 认知核停止完成");
  }

  public get isReady(): boolean {
    return this._isReady && this._isRunning;
  }
}
