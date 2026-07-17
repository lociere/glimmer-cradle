/**
 * 可观测性 Logger（Kernel 内核全局日志器）
 * ─────────────────────────────────────────────────────────────
 * • 基于 winston，输出到控制台 + 机器 JSONL + 人读 pretty + 错误专属日志文件
 * • 控制台  彩色 + 模块标签格式：`HH:mm:ss.SSS [level] [module] 消息 key=value`
 * • 机器日志 JSONL 格式，便于后续离线分析
 * • 人读日志 pretty 格式，只展示主线字段，便于开发时直接打开阅读
 * • 轮转    主日志 10 MB × 5；错误日志 5 MB × 3
 * • 幂等性  initLogger 重复调用安全
 */
import { createLogger, format, transports, Logger } from 'winston';
import path from 'path';
import fs from 'fs-extra';
import { resolveLogDir } from '../utils/path-utils';
import { getCurrentTraceId, getCurrentSpanId, syntheticTraceId } from './trace-context';

const { combine, timestamp, printf, json, colorize } = format;

// ──────────────────────────────────────────────────────────────────────────────
// trace 上下文自动注入（从 AsyncLocalStorage 读取当前异步上下文）
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Winston format：注入 trace_id + span_id（内核侧无 session/epoch —— 见
 * docs/architecture/current/log-fields-glossary.md §5.4）。
 *
 * trace_id 优先级：显式传 > ALS 上下文 > `synthetic-{module}-{n}` 合成占位。
 * span_id：仅在当前处于 span 上下文时注入。
 */
const _traceContextInjector = format((info) => {
  // trace_id：显式 > ALS 上下文 > 模块名合成占位
  if (info.trace_id === undefined) {
    const current = getCurrentTraceId();
    if (current !== undefined) {
      info.trace_id = current;
    } else {
      const module = (info.module as string | undefined) ?? 'unknown';
      info.trace_id = syntheticTraceId(module);
    }
  }
  // span_id：存在才注入（多数日志无 span）
  if (info.span_id === undefined) {
    const span = getCurrentSpanId();
    if (span !== undefined) {
      info.span_id = span;
    }
  }
  return info;
});

// ──────────────────────────────────────────────────────────────────────────────
// 内部状态
// ──────────────────────────────────────────────────────────────────────────────

let _initialized = false;

// ──────────────────────────────────────────────────────────────────────────────
// 日志目录（优先 LOG_DIR 环境变量）
// ──────────────────────────────────────────────────────────────────────────────

function _resolveInitialLogDir(): string {
  const logRoot = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : resolveLogDir();
  return path.join(logRoot, 'application');
}

const _initialLogDir = _resolveInitialLogDir();
fs.ensureDirSync(_initialLogDir);

// ──────────────────────────────────────────────────────────────────────────────
// 格式定义
// ──────────────────────────────────────────────────────────────────────────────

function _formatPrimitive(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= 96 && !/\s/.test(text)) return text;
  return JSON.stringify(text.length > 120 ? `${text.slice(0, 117)}...` : text);
}

const HUMAN_META_KEYS = new Set([
  'phase',
  'runtime_module',
  'startup_time_ms',
  'total_startup_time_ms',
  'mode',
  'module_count',
  'current_state',
  'exit_code',
  'readiness',
  'waited_ms',
  'status',
  'ready',
  'blocking',
  'from',
  'to',
  'event_type',
  'message_type',
  'code',
  'signal',
  'error',
]);

function _formatHumanMeta(meta: Record<string, unknown>): string {
  const { splat: _s, trace_id: _traceId, span_id: _spanId, stack: _stack, startup_plan: _plan, ...rest } = meta as any;
  const entries = Object.entries(rest)
    .filter(([key, value]) => value !== undefined && HUMAN_META_KEYS.has(key))
    .slice(0, 5)
    .map(([key, value]) => `${key}=${_formatPrimitive(value)}`);

  return entries.join(' ');
}

function _humanFormat(options: { color: boolean }) {
  return printf(({ level, message, timestamp: ts, module: mod, ...meta }) => {
    const modTag = mod
      ? options.color
        ? ` \x1b[36m[${mod}]\x1b[0m`
        : ` [${mod}]`
      : '';
    const metaStr = _formatHumanMeta(meta as Record<string, unknown>);
    const renderedMeta = metaStr
      ? options.color
        ? ` \x1b[90m${metaStr}\x1b[0m`
        : ` ${metaStr}`
      : '';
    return `${ts} [${level}]${modTag} ${message}${renderedMeta}`;
  });
}

/**
 * 控制台格式：`HH:mm:ss.SSS [level] [module] 消息 key=value`
 * meta 只展示主线字段，路径、启动计划、堆栈等完整结构保留在 kernel.jsonl。
 */
const _consoleFormat = _humanFormat({ color: true });
const _prettyFileFormat = _humanFormat({ color: false });

// ──────────────────────────────────────────────────────────────────────────────
// 核心 logger 实例
// ──────────────────────────────────────────────────────────────────────────────

const _baseLogger: Logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  // 文件 transport：ISO 8601 ms 精度时间戳（Date.toISOString = 2026-05-08T07:03:33.522Z）
  // 与 Python structlog 协议层时间戳格式对齐，便于跨进程时间线排序
  format: combine(_traceContextInjector(), timestamp({ format: () => new Date().toISOString() }), json()),
  transports: [
    // ── 控制台（短时间戳，便于人眼读）
    new transports.Console({
      format: combine(
        _traceContextInjector(),
        colorize({ level: true }),  // 仅为 level 字段着色
        timestamp({ format: 'HH:mm:ss.SSS' }),
        _consoleFormat,
      ),
    }),
    // ── 主日志文件（全量，10 MB × 5 轮转）
    new transports.File({
      filename: path.join(_initialLogDir, 'kernel.jsonl'),
      level: 'debug',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      // Windows 默认非 UTF-8，显式指定避免中文乱码
      options: { encoding: 'utf8' },
    } as any),
    // ── 人读日志文件（与控制台同形，但无 ANSI 颜色）
    new transports.File({
      filename: path.join(_initialLogDir, 'kernel.pretty.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: combine(
        _traceContextInjector(),
        timestamp({ format: 'HH:mm:ss.SSS' }),
        _prettyFileFormat,
      ),
      options: { encoding: 'utf8' },
    } as any),
    // ── 错误日志文件（WARNING 以上，5 MB × 3 轮转，快速排查首选）
    new transports.File({
      filename: path.join(_initialLogDir, 'kernel.errors.jsonl'),
      level: 'warn',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      options: { encoding: 'utf8' },
    } as any),
  ],
});

// ──────────────────────────────────────────────────────────────────────────────
// 公共接口类型
// ──────────────────────────────────────────────────────────────────────────────

/** 模块级日志器接口 */
export interface ILogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  /**
   * 严重错误。与 error 相同级别，但在 meta 中附加 `critical: true` 标记，
   * 便于日志收集系统单独告警。
   */
  critical(message: string, meta?: Record<string, unknown>): void;
  /**
   * 动态级别输出（由调用方传入 winston 级别字符串，如 `"info"`、`"warn"`）。
   * 用于外部系统（如 Cognition 认知核）通过 IPC 上报指定级别的日志。
   */
  log(level: string, message: string, meta?: Record<string, unknown>): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// 公共 API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 全局日志器初始化（由 app.ts 在加载配置后调用，幂等安全）。
 * 主要作用：将日志级别与文件输出路径更新为配置指定值。
 */
export function initLogger(config: {
  observability?: {
    level?: string;
  };
} = {}): void {
  if (_initialized) return;
  _initialized = true;

  const level = config.observability?.level ?? process.env.LOG_LEVEL ?? 'info';
  _baseLogger.level = level;

  const logRoot = process.env.LOG_DIR
    ? path.resolve(process.env.LOG_DIR)
    : resolveLogDir();
  const targetDir = path.join(logRoot, 'application');

  // 仅当目录与初始目录不同时才替换文件 transport，避免无谓的文件操作
  if (path.resolve(targetDir) !== path.resolve(_initialLogDir)) {
    fs.ensureDirSync(targetDir);
    _baseLogger.transports
      .filter((t) => t instanceof transports.File)
      .forEach((t) => _baseLogger.remove(t));
    _baseLogger.add(new transports.File({
      filename: path.join(targetDir, 'kernel.jsonl'),
      level: 'debug',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      options: { encoding: 'utf8' },
    } as any));
    _baseLogger.add(new transports.File({
      filename: path.join(targetDir, 'kernel.pretty.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: combine(
        _traceContextInjector(),
        timestamp({ format: 'HH:mm:ss.SSS' }),
        _prettyFileFormat,
      ),
      options: { encoding: 'utf8' },
    } as any));
    _baseLogger.add(new transports.File({
      filename: path.join(targetDir, 'kernel.errors.jsonl'),
      level: 'warn',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      options: { encoding: 'utf8' },
    } as any));
  }
}

/** 关闭所有 transport（进程退出前调用）。 */
export function closeLogger(): void {
  _baseLogger.transports.forEach((t) => t.close?.());
}

/**
 * 获取模块级 logger。
 * 每条日志会自动注入 `module` 字段，无需在每次调用时手动传入。
 *
 * @param name 模块名（如 `"config-manager"`、`"ipc-server"`）
 */
export function getLogger(name = 'core'): ILogger {
  return {
    debug:    (message, meta = {}) => _baseLogger.debug(message,   { module: name, ...meta }),
    info:     (message, meta = {}) => _baseLogger.info(message,    { module: name, ...meta }),
    warn:     (message, meta = {}) => _baseLogger.warn(message,    { module: name, ...meta }),
    error:    (message, meta = {}) => _baseLogger.error(message,   { module: name, ...meta }),
    critical: (message, meta = {}) => _baseLogger.error(message,   { module: name, critical: true, ...meta }),
    log:      (level, message, meta = {}) => _baseLogger.log(level, message, { module: name, ...meta }),
  };
}

export { _baseLogger as baseLogger };
export { withTrace, getCurrentTraceId, newTraceId } from './trace-context';
