"""
文件名称：kernel_event_port.py
所属层级：端口层-出站端口
核心作用：定义出站事件的抽象接口，遵循依赖倒置原则
设计原则：
1. 仅定义抽象接口，不做实现
2. 所有发送给内核的事件，必须通过此接口定义
3. 完全屏蔽底层通信细节，领域层/应用层仅依赖此接口
"""
from abc import ABC, abstractmethod


class KernelEventPort(ABC):
    """
    内核事件出站端口抽象接口
    核心作用：定义AI层能发送给内核的所有事件，完全屏蔽底层通信细节
    真人逻辑对齐：对应人脑的动作输出接口，仅定义能发送什么信号，不关心信号到哪里去
    """

    @abstractmethod
    async def send_state_sync(self, state: dict) -> None:
        """
        发送状态同步事件给内核，同步给渲染层
        参数：
            state: 当前角色状态字典
        """
        pass

    @abstractmethod
    async def send_log(self, level: str, message: str, extra: dict = None) -> None:
        """
        发送日志事件给内核，统一日志管理
        参数：
            level: 日志级别
            message: 日志内容
            extra: 额外参数
        """
        pass

    @abstractmethod
    async def send_action_command(self, command: dict) -> None:
        """
        发送 ActionCommand 给 Kernel。

        CycleController 的 Act 阶段决定开口时，把 reply intent 转成 ActionCommand
        经此推送给内核（Python → 内核单向，非 RPC）。内核侧映射为 ChannelReplyEvent
        走现有适配器回传链路。

        参数：
            command: ActionCommand dict（与 schemas/models/ActionCommand 对齐：
                     trace_id / action_type / target / payload / emotion_state）
        """
        pass
