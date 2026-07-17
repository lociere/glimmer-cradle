"""
文件名称：base_use_case.py
所属层级：应用层
核心作用：用例基类，定义统一的用例执行流程，统一异常处理、日志、追踪
设计原则：
1. 仅做流程编排，不碰业务规则
2. 统一全链路trace_id透传
3. 统一异常处理，不吞异常
4. 所有用例必须继承此类
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from uuid import uuid4
from typing import ClassVar, Generic, TypeVar
from glimmer_cradle.cognition.observability.logger import get_logger

# 泛型定义：输入/输出类型
Input = TypeVar("Input")
Output = TypeVar("Output")

# 初始化模块日志器
logger = get_logger("base_use_case")


# ======================================
# 用例基类
# ======================================
@dataclass
class BaseUseCase(ABC, Generic[Input, Output]):
    """
    用例基类，所有应用层用例必须继承
    核心作用：统一执行流程、异常处理、全链路追踪
    """
    use_case_name: str = field(init=False)
    lifecycle_log_level: ClassVar[str] = "info"

    def __post_init__(self) -> None:
        """自动设置用例名称为子类类名，无需手动赋值"""
        self.use_case_name = self.__class__.__name__

    def _log_lifecycle(self, message: str, trace_id: str) -> None:
        if self.lifecycle_log_level == "debug":
            logger.debug(message, trace_id=trace_id)
            return
        logger.info(message, trace_id=trace_id)

    @abstractmethod
    async def _execute(self, input_data: Input, trace_id: str) -> Output:
        """
        用例核心执行逻辑，子类必须实现
        【规范】：仅做流程编排，所有业务规则必须调用领域层实现
        参数：
            input_data: 用例输入
            trace_id: 全链路追踪ID
        返回：用例输出
        """
        pass

    async def execute(self, input_data: Input, trace_id: str = None) -> Output:
        """
        用例统一执行入口，外部仅能调用此方法
        参数：
            input_data: 用例输入
            trace_id: 全链路追踪ID，不传则自动生成
        返回：用例输出
        异常：所有业务异常向上抛出，不吞异常
        """
        # 生成全链路追踪ID，保证全流程可追溯
        trace_id = trace_id or str(uuid4())
        self._log_lifecycle(f"用例 {self.use_case_name} 开始执行", trace_id)

        try:
            # 执行子类实现的核心逻辑
            result = await self._execute(input_data, trace_id)
            self._log_lifecycle(f"用例 {self.use_case_name} 执行成功", trace_id)
            return result

        except Exception as e:
            # 异常日志记录，不吞异常，继续向上抛出
            logger.error(
                f"用例 {self.use_case_name} 执行失败",
                trace_id=trace_id,
                error=str(e),
                exc_info=True
            )
            raise e