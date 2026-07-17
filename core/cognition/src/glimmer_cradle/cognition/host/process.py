"""Cognition 进程 Host：管理启动、停止和 Kernel Port 生命周期。"""
# ruff: noqa: E402 -- 源码直启时必须先完成 sys.path 与 Windows event loop 引导。
import asyncio
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Final

# Ensure that `glimmer_cradle.cognition` package can be imported when run from source (without installing). This is
# especially important when the TS kernel launches Python via `python -m glimmer_cradle.cognition.host.process`.
# It locates the repository root by walking upward until it finds a `pyproject.toml` or `pnpm-workspace.yaml`.
# Then it prepends the Python source directory to sys.path.
repo_root = Path(__file__).resolve()
for _ in range(20):
    # Prefer the monorepo root marker. If not found, fallback to pyproject.toml.
    if (repo_root / "pnpm-workspace.yaml").exists():
        break
    if (repo_root / "pyproject.toml").exists():
        # Note: this pyproject may be inside a subpackage; keep searching for pnpm-workspace.yaml.
        pass
    if repo_root.parent == repo_root:
        break
    repo_root = repo_root.parent

src_path = repo_root / "core" / "cognition" / "src"
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

# On Windows, asyncio defaults to ProactorEventLoop which is incompatible with zmq's add_reader.
# Ensure selector policy is set before any zmq/asyncio interaction.
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except AttributeError:
        pass

from glimmer_cradle.cognition.foundation.config import CharacterRuntimeConfig
from glimmer_cradle.cognition.host.composition import CognitionComponents, compose_cognition
from glimmer_cradle.cognition.foundation.lifecycle import Lifecycle
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import new_boot_id, set_boot_id
from glimmer_cradle.cognition.foundation.path_utils import (
    resolve_metrics_dir,
    resolve_traces_dir,
)
from glimmer_cradle.cognition.observability.metrics import start_metrics, stop_metrics
from glimmer_cradle.cognition.observability.tracer import start_tracer, stop_tracer
from glimmer_cradle.cognition.protocol.generated.enums.ipc_message_type import IPCMessageType

# 初始化模块日志器
logger = get_logger("cognition_host")

STATE_SYNC_FALLBACK_INTERVAL_S = 30.0
STATE_SYNC_LOOP_INTERVAL_S = 5.0


# ======================================
# Cognition 认知核主类
# ======================================
class CognitionHost(Lifecycle):
    """
    Cognition 认知核主类，管理整个认知层的完整生命周期。
    核心作用：作为认知层根节点，统一管理所有模块的启动、运行、停止。
    """
    def __init__(self, config: CharacterRuntimeConfig, bind_address: str):
        """
        初始化AI核心
        参数：
            config: 内核注入的全局冻结配置
            bind_address: ZMQ IPC绑定地址，用于和Kernel 内核通信
        异常：
            ConfigException: 配置校验失败时抛出
        """
        # 全局冻结配置，会话期不可修改
        self.config: Final[CharacterRuntimeConfig] = config
        # IPC绑定地址
        self.bind_address: Final[str] = bind_address
        self.components: CognitionComponents | None = None
        # 运行状态
        self._is_running: bool = False
        # 主运行任务
        self._main_task: asyncio.Task | None = None
        self._last_state_sync_fingerprint: str | None = None
        self._last_state_sync_at: float = 0.0
        self._shutdown_task: asyncio.Task | None = None
        self._stop_task: asyncio.Task | None = None

        logger.info("Cognition 认知核初始化完成", name=config.manifest.base.name)

    async def start(self) -> None:
        """
        启动AI核心，按顺序初始化所有模块
        规范：幂等性，重复调用不会产生副作用
        """
        if self._is_running:
            logger.warning("Cognition 认知核已在运行中，无需重复启动")
            return
        if self._stop_task is not None and self._stop_task.done():
            self._stop_task = None

        try:
            logger.info("Cognition 认知核开始启动")

            self.components = compose_cognition(self.config)
            components = self._require_components()
            components.kernel_bridge.register_handler(
                IPCMessageType.COGNITION_SHUTDOWN,
                self._accept_shutdown_request,
            )

            # 1.5 启动经历记录器（Glimmer Cradle 架构蓝图 §4.1，脊柱①）
            #     先确立进程级 boot_id（telemetry 层用，蓝图 §6.2），经历之流本身是连续的，
            #     不写 SESSION_START/EPOCH_START 这类"生命周期事件" —— 那是 telemetry 的事。
            set_boot_id(new_boot_id())
            experience_recorder = components.experience_recorder
            await experience_recorder.start()

            # 先启动 metrics 与 tracer，保留启动期诊断。
            #     须在记忆/知识加载之前 —— 启动期的 gauge / span 才不会丢。
            await start_metrics(resolve_metrics_dir())
            await start_tracer(resolve_traces_dir())

            # 认知活动控制器先于认知循环启动，保证首拍可读取完整 policy。
            activity_controller = components.activity_controller
            activity_controller.on_transition(self._request_state_sync)
            await activity_controller.start()

            # 1.66 先连接事实库并恢复投影，认知循环不得在 repository ready 前消费输入。
            cognition_database = components.cognition_database
            await cognition_database.connect()
            await components.conversation_controller.connect()
            await components.self_entity.memory.load()
            await components.self_entity.knowledge_base.load_persisted()
            await components.maintenance_scheduler.start()

            # 1.67 启动认知循环。
            await components.cycle_controller.start()

            # 2. 启动内核通信桥接
            kernel_bridge = components.kernel_bridge
            connect_address = self.bind_address
            # 适配本地回环地址
            if connect_address.startswith("tcp://0.0.0.0"):
                connect_address = connect_address.replace("tcp://0.0.0.0", "tcp://127.0.0.1")

            # 启动连接
            await kernel_bridge.start(connect_address)

            # 3. 唤醒当前角色
            self_entity = components.self_entity
            self_entity.wake_up()

            # 4. 发出首条状态同步消息。启动快照用于建立 Kernel/Renderer 投影，
            # 不代表一次认知活动状态转换。
            await self._send_state_sync_if_needed(force=True)

            # 5. 标记为运行中
            self._is_running = True

            # 6. 启动主运行循环
            self._main_task = asyncio.create_task(self._main_loop())

            logger.info("Cognition 认知核启动成功，当前角色已醒来")

        except Exception as e:
            logger.critical(f"Cognition 认知核启动失败: {str(e)}", exc_info=True)
            await self.stop()
            raise e

    async def stop(self) -> None:
        """并发停机请求共享同一收尾任务，避免信号与 IPC 重复释放资源。"""
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop_components())
        await asyncio.shield(self._stop_task)

    async def _stop_components(self) -> None:
        """
        停止AI核心，优雅关闭所有资源
        规范：幂等性，重复调用不会报错，必须释放所有资源
        """
        logger.info("Cognition 认知核开始停止")
        self._is_running = False

        # 1. 停止主运行循环
        if self._main_task and not self._main_task.done():
            self._main_task.cancel()
            try:
                await self._main_task
            except asyncio.CancelledError:
                pass

        # 2. 依次停止入站、认知生产者与持久化消费者。
        if self.components is not None:
            components = self.components
            # 先关闭 Kernel 入站，避免停机期间继续接收新感知。
            try:
                await components.kernel_bridge.stop()
            except Exception as e:
                logger.error(f"Error stopping kernel bridge: {e}")

            # 停止认知循环后，Experience 不再产生新的对话 Moment。
            try:
                await components.cycle_controller.stop()
            except Exception as e:
                logger.error(f"Error stopping cognitive loop: {e}")

            try:
                self_entity = components.self_entity
                self_entity.sleep()
            except Exception as e:
                logger.error(f"Error during entity sleep: {e}")

            # 再停认知活动控制器，避免状态 tick 读取已关闭的认知组件。
            try:
                await components.activity_controller.stop()
            except Exception as e:
                logger.error(f"Error stopping cognitive activity controller: {e}")

            # Ledger 仍可读时刷新并封口 Episode；未巩固 Episode 会在下次启动后重试。
            try:
                await components.maintenance_scheduler.stop()
            except Exception as e:
                logger.error(f"Error sealing episode projection: {e}")

            # Ledger 仍可读时先把 Conversation 投影推进到最终 checkpoint。
            try:
                await components.conversation_controller.close()
            except Exception as e:
                logger.error(f"Error closing conversation store: {e}")

            # 最后停止 Experience 单写者。进程关闭属于 telemetry，不写伪造 Moment。
            try:
                experience_recorder = components.experience_recorder
                await experience_recorder.stop()
            except Exception as e:
                logger.error(f"Error stopping experience recorder: {e}")

            try:
                await components.cognition_database.close()
            except Exception as e:
                logger.error(f"Error closing cognition database: {e}")

            # 最后刷新遥测，确保上述停机错误仍可被记录。
            try:
                await stop_metrics()
            except Exception as e:
                logger.error(f"Error stopping metrics writer: {e}")
            try:
                await stop_tracer()
            except Exception as e:
                logger.error(f"Error stopping span writer: {e}")

        logger.info("Cognition 认知核已停止，当前角色已进入休眠")

    async def _accept_shutdown_request(self, _message: dict) -> dict[str, str]:
        if self._shutdown_task is None or self._shutdown_task.done():
            self._shutdown_task = asyncio.create_task(self._shutdown_after_ack())
        return {"status": "accepted"}

    async def _shutdown_after_ack(self) -> None:
        # 先让 KernelBridge 发回 ACK，再关闭承载该请求的通信边界。
        await asyncio.sleep(0.05)
        await self.stop()
        asyncio.get_running_loop().stop()

    async def _main_loop(self) -> None:
        """主运行循环，保持进程运行，处理心跳和状态同步"""
        logger.info("主运行循环已启动")
        while self._is_running:
            try:
                # 同步当前状态给内核：语义变化立即同步，低频兜底刷新。
                await self._send_state_sync_if_needed()

                await asyncio.sleep(STATE_SYNC_LOOP_INTERVAL_S)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"主运行循环异常: {str(e)}", exc_info=True)
                await asyncio.sleep(1)

    def _request_state_sync(self) -> None:
        if not self._is_running:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._send_state_sync_if_needed(force=True))

    async def _send_state_sync_if_needed(self, *, force: bool = False) -> None:
        if self.components is None:
            return

        self_entity = self.components.self_entity
        state = self_entity.get_state()
        fingerprint = self._state_sync_fingerprint(state)
        now = asyncio.get_running_loop().time()
        elapsed = now - self._last_state_sync_at

        if (
            not force
            and fingerprint == self._last_state_sync_fingerprint
            and elapsed < STATE_SYNC_FALLBACK_INTERVAL_S
        ):
            return

        outbound_adapter = self.components.outbound_adapter
        await outbound_adapter.send_state_sync(state)
        self._last_state_sync_fingerprint = fingerprint
        self._last_state_sync_at = now

    def _require_components(self) -> CognitionComponents:
        if self.components is None:
            raise RuntimeError("Cognition 尚未完成组件组装")
        return self.components

    @staticmethod
    def _state_sync_fingerprint(state: dict) -> str:
        """构建状态同步指纹。

        `cognitive_activity.idle_seconds` 属于持续流逝的时间投影，不应让每秒快照
        都变成语义变化。真正触发同步的是 emotion 与 activity state/policy。
        """
        activity = state.get("cognitive_activity") if isinstance(state, dict) else None
        stable_activity = {}
        if isinstance(activity, dict):
            stable_activity = {
                "state": activity.get("state"),
                "since_at": activity.get("since_at"),
                "policy": activity.get("policy"),
            }

        stable = {
            "name": state.get("name"),
            "is_awake": state.get("is_awake"),
            "emotion": state.get("emotion"),
            "memory_count": state.get("memory_count"),
            "cognitive_activity": stable_activity,
        }
        return json.dumps(stable, sort_keys=True, ensure_ascii=False, default=str)


# ======================================
# 命令行启动入口
# ======================================
def main(argv: list[str] | None = None) -> int:
    """
    Cognition 认知核唯一命令行启动入口
    由Kernel 内核通过子进程启动，所有参数由内核传入
    启动参数示例：
    python -m glimmer_cradle.cognition.host.process --config-json '{...}' --bind-address tcp://127.0.0.1:<dynamic>

    也支持通过环境变量注入（供 Kernel 内核启动时使用）：
      GLIMMER_CRADLE_CONFIG / GLIMMER_CRADLE_IPC_BIND_ADDRESS
    """
    # 解析命令行参数
    parser = argparse.ArgumentParser(description="Glimmer Cradle Cognition 认知核")
    parser.add_argument(
        "--config-json",
        type=str,
        required=False,
        help="JSON格式的全局配置字符串，由Kernel 内核注入（优先）"
    )
    parser.add_argument(
        "--bind-address",
        type=str,
        required=False,
        help="ZMQ IPC绑定地址，用于和Kernel 内核通信（优先）"
    )
    args = parser.parse_args(argv)

    # 解析配置（支持通过环境变量传入）
    try:
        import json

        config_json = args.config_json or os.environ.get("GLIMMER_CRADLE_CONFIG")
        bind_address = args.bind_address or os.environ.get("GLIMMER_CRADLE_IPC_BIND_ADDRESS")

        if not config_json or not bind_address:
            raise ValueError("缺少 GLIMMER_CRADLE_CONFIG 或 GLIMMER_CRADLE_IPC_BIND_ADDRESS，无法启动")

        config_dict = json.loads(config_json)
        config = CharacterRuntimeConfig(**config_dict)
    except Exception as e:
        logger.critical(f"配置解析失败: {str(e)}", exc_info=True)
        return 1

    # 创建认知核实例
    cognition_host = CognitionHost(config=config, bind_address=bind_address)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    exit_code = 0

    # 优雅停机信号
    import signal

    async def shutdown() -> None:
        await cognition_host.stop()
        loop.stop()

    def _register_signal(sig: signal.Signals) -> None:
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown()))
        except NotImplementedError:
            # Windows 的同步 signal handler 只负责把停机任务投递回事件循环。
            signal.signal(
                sig,
                lambda *_: loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(shutdown())
                ),
            )

    for sig in (signal.SIGINT, signal.SIGTERM):
        _register_signal(sig)

    # 启动认知核
    try:
        loop.run_until_complete(cognition_host.start())
        loop.run_forever()
    except KeyboardInterrupt:
        logger.info("收到停机信号，正在优雅关闭...")
    except Exception as e:
        logger.critical(f"Cognition 认知核运行异常: {str(e)}", exc_info=True)
        exit_code = 1
    finally:
        try:
            if not loop.is_closed():
                loop.run_until_complete(cognition_host.stop())
        except Exception as e:
            logger.critical(f"Cognition 认知核停机异常: {str(e)}", exc_info=True)
            exit_code = 1
        finally:
            loop.close()
            asyncio.set_event_loop(None)
    return exit_code


# 直接运行时启动
if __name__ == "__main__":
    raise SystemExit(main())
