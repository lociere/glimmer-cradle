"""
文件名称：kernel_bridge.py
所属层级：适配器层 - 出站基础设施（adapters/outbound）
核心作用：Cognition 认知核与 Kernel 内核通信的唯一入口，基于 ZMQ 的 IPC 通信
设计原则：
1. 是AI层与内核通信的唯一入口，所有跨进程通信必须经过这里
2. 仅做通信和消息收发，不碰任何业务逻辑
3. 完全屏蔽底层通信细节，上层仅需调用标准化接口
4. 严格遵循全链路trace_id透传
"""
import asyncio
import zmq
import zmq.asyncio
from typing import Callable, Coroutine, Any
from glimmer_cradle.cognition.foundation.exceptions import BridgeException
from glimmer_cradle.cognition.protocol.generated.enums.error_code import ErrorCode
from glimmer_cradle.cognition.protocol.generated.enums.ipc_message_type import IPCMessageType
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import TraceContext, new_trace_id
from glimmer_cradle.cognition.observability.tracer import with_remote_parent_span

# 初始化模块日志器
logger = get_logger("kernel_bridge")


class KernelBridge:
    """由 CognitionComponents 独占的 ZMQ Kernel 通信桥。"""

    def __init__(self) -> None:
        self._context = zmq.asyncio.Context()
        self._socket: zmq.asyncio.Socket | None = None
        self._handlers: dict[str, Callable[[dict], Coroutine[Any, Any, Any]]] = {}
        self._is_running: bool = False
        self._receive_task: asyncio.Task | None = None
        self._inflight_tasks: dict[str, asyncio.Task] = {}
        self._send_lock = asyncio.Lock()
        logger.info("内核通信桥接初始化完成")

    def register_handler(self, message_type: str, handler: Callable[[dict], Coroutine[Any, Any, Any]]) -> None:
        """
        注册消息处理器
        参数：
            message_type: 消息类型
            handler: 异步处理函数，入参为消息字典
        """
        self._handlers[message_type] = handler
        logger.info(f"注册消息处理器: {message_type}")

    async def start(self, connect_address: str) -> None:
        """
        启动桥接服务，连接到内核的 Router 地址
        参数：
            connect_address: Kernel 启动时发布的回环 ZMQ 动态端点
        异常：
            BridgeException: 启动失败时抛出
        """
        if self._is_running:
            logger.warning("内核桥接已在运行中，无需重复启动")
            return

        try:
            self._socket = self._context.socket(zmq.DEALER)
            self._socket.connect(connect_address)
            self._is_running = True
            self._receive_task = asyncio.create_task(self._receive_loop())
            logger.info(f"内核桥接启动成功，连接地址: {connect_address}")

        except Exception as e:
            raise BridgeException(f"内核桥接启动失败: {str(e)}")

    async def stop(self) -> None:
        """停止桥接服务，优雅关闭所有资源"""
        self._is_running = False

        for trace_id, task in list(self._inflight_tasks.items()):
            if not task.done():
                task.cancel()
            self._inflight_tasks.pop(trace_id, None)

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        if self._socket:
            self._socket.close()
            self._socket = None

        self._context.term()
        logger.info("内核桥接已停止")

    async def send_message(self, message: dict) -> None:
        """
        发送消息给内核（Dealer -> Router）
        参数：
            message: 标准化消息字典
        异常：
            BridgeException: 发送失败时抛出
        """
        if not self._is_running or not self._socket:
            raise BridgeException("内核桥接未启动，无法发送消息")

        try:
            async with self._send_lock:
                await self._socket.send_json(message)
            logger.debug("消息发送成功", message_type=message.get("type"))
        except Exception as e:
            raise BridgeException(f"消息发送失败: {str(e)}")

    async def _send_response(self, response: dict) -> None:
        """在并发场景下安全发送响应。"""
        if not self._socket:
            return
        async with self._send_lock:
            await self._socket.send_json(response)

    async def _run_handler_task(self, message: dict, handler: Callable[[dict], Coroutine[Any, Any, Any]]) -> None:
        """执行单个请求处理任务，确保每个请求独立可取消。

        进入处理前，把 IPC 信封里的 ``trace_id`` + 可选 ``span_id`` 建为本协程的
        trace 上下文 —— 这样下游 ``with span(...)`` 自动挂到内核侧 span 之下
        （Glimmer Cradle 架构蓝图 §6.2 跨进程 span 嵌套）。
        """
        trace_id = message.get("trace_id", "") or new_trace_id()
        parent_span_id = message.get("span_id") or None
        message_type = message.get("type")

        try:
            with TraceContext(trace_id):
                if parent_span_id:
                    with with_remote_parent_span(trace_id, parent_span_id):
                        result = await handler(message)
                else:
                    result = await handler(message)
            response = {
                "type": IPCMessageType.SUCCESS_RESPONSE,
                "trace_id": trace_id,
                "success": True,
                "payload": None,
            }

            if hasattr(result, "model_dump"):
                response["payload"] = result.model_dump(mode="json")
            elif hasattr(result, "__dict__"):
                response["payload"] = result.__dict__
            elif hasattr(result, "_asdict"):
                response["payload"] = result._asdict()
            else:
                response["payload"] = result

            await self._send_response(response)
        except asyncio.CancelledError:
            logger.info(
                "请求处理任务已取消",
                message_type=message_type,
                trace_id=trace_id,
            )
            await self._send_response({
                "type": IPCMessageType.ERROR_RESPONSE,
                "trace_id": trace_id,
                "success": False,
                "error": {
                    "code": ErrorCode.CANCELLED,
                    "message": "请求已被中断",
                },
            })
            raise
        except Exception as e:
            logger.error(
                f"消息处理器执行失败: {str(e)}",
                message_type=message_type,
                trace_id=trace_id,
                exc_info=True
            )
            await self._send_response({
                "type": IPCMessageType.ERROR_RESPONSE,
                "trace_id": trace_id,
                "success": False,
                "error": {
                    "code": getattr(e, "code", ErrorCode.UNKNOWN),
                    "message": str(e),
                },
            })
        finally:
            if trace_id and self._inflight_tasks.get(trace_id):
                self._inflight_tasks.pop(trace_id, None)

    async def _handle_cancel_request(self, message: dict) -> None:
        """按 trace_id 取消正在执行的请求任务。"""
        trace_id = message.get("trace_id", "")
        payload = message.get("payload", {}) or {}
        target_trace_id = str(payload.get("target_trace_id", "")).strip()

        cancelled = False
        if target_trace_id:
            task = self._inflight_tasks.get(target_trace_id)
            if task and not task.done():
                task.cancel()
                cancelled = True

        await self._send_response({
            "type": IPCMessageType.SUCCESS_RESPONSE,
            "trace_id": trace_id,
            "success": True,
            "payload": {
                "target_trace_id": target_trace_id,
                "cancelled": cancelled,
            },
        })

    async def _receive_loop(self) -> None:
        """后台接收循环，持续接收内核的消息，分发给对应的处理器"""
        logger.info("内核消息接收循环已启动")
        while self._is_running:
            try:
                message = await self._socket.recv_json()
                message_type = message.get("type")
                trace_id = message.get("trace_id", "")
                logger.debug(
                    "收到内核消息",
                    message_type=message_type,
                    trace_id=trace_id
                )

                if message_type in {
                    IPCMessageType.SUCCESS_RESPONSE.value,
                    IPCMessageType.ERROR_RESPONSE.value,
                }:
                    logger.debug(
                        "收到内核响应帧，当前通道为单向推送，已忽略",
                        message_type=message_type,
                        trace_id=trace_id,
                    )
                    continue

                handler = self._handlers.get(message_type)
                if message_type == "perception_cancel":
                    await self._handle_cancel_request(message)
                    continue

                if not handler:
                    logger.warning(f"未找到消息类型 {message_type} 的处理器")
                    continue

                task = asyncio.create_task(self._run_handler_task(message, handler))
                if trace_id:
                    self._inflight_tasks[trace_id] = task

            except zmq.ZMQError as e:
                if self._is_running:
                    logger.error(f"ZMQ通信错误: {str(e)}", exc_info=True)
                await asyncio.sleep(0.1)
            except Exception as e:
                logger.error(f"消息接收循环异常: {str(e)}", exc_info=True)
                await asyncio.sleep(0.1)
