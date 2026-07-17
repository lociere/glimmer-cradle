"""
认知循环专家模块基类。

每个 Provider 是一个常驻协程，每拍认知循环被并发调用 ``propose()`` —— 读当前
工作区快照，根据自身职责产出新候选列表（``WorkspaceItem``）。

设计约束：
- propose() 必须**纯**：不直接改写工作区（CycleController 收集结果后统一 propose）
- propose() 可读外部状态（情绪系统、记忆库、感知队列等）—— 各 Provider 自定
- 异步：长 IO（向量检索 / LLM 调用）应 await；CPU 重活走 asyncio.to_thread
- 异常隔离：CycleController 单独捕获各 Provider 的异常，不让一个崩溃影响其他
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem


class Provider(ABC):
    """专家模块基类。子类必须实现 ``name`` 与 ``propose()``。"""

    #: provider 名（与 WorkspaceItem.source 枚举一一对应）
    name: str = ""

    @abstractmethod
    async def propose(self, workspace_snapshot: list[WorkspaceItem]) -> list[WorkspaceItem]:
        """读当前工作区快照 → 产出本拍候选。

        Args:
            workspace_snapshot: 当前工作区所有项的副本（仅读）

        Returns:
            新候选列表；空列表表示本拍无投放（合法常态）
        """
        ...
