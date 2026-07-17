"""
文件名称：lifecycle.py
所属层级：基础设施层
核心作用：定义统一的生命周期标准接口，所有需要启动/停止的模块必须实现
设计原则：接口隔离原则，仅定义核心的启动/停止方法，保证全模块生命周期管理统一
"""
from abc import ABC, abstractmethod


class Lifecycle(ABC):
    """生命周期抽象接口，所有需要管理生命周期的模块必须实现"""

    @abstractmethod
    async def start(self) -> None:
        """
        启动模块
        规范：必须实现幂等性，重复调用不会产生副作用
        异常：启动失败必须抛出明确异常，不吞异常
        """
        pass

    @abstractmethod
    async def stop(self) -> None:
        """
        停止模块，优雅停机
        规范：必须实现幂等性，重复调用不会报错；必须释放所有资源
        """
        pass