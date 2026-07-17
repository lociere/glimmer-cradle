"""
文件名称：exceptions.py
所属层级：基础设施层
核心作用：定义分层异常体系，区分系统异常和业务异常，便于问题定位
设计原则：异常分层分类，不同层级有专属异常类型，异常携带 typed ErrorCode

错误码单一事实源：protocol/src/schemas/enums/ErrorCode.schema.json，
由 sync:contracts codegen（Protocol 契约铁律 1）。异常类的 ``code`` 字段
统一用 ErrorCode 枚举 —— 随 IPC 错误响应跨进程传递，与 Kernel 内核对齐。
"""
from glimmer_cradle.cognition.protocol.generated.enums.error_code import ErrorCode


# ======================================
# 核心系统异常基类（基础设施层/适配器层/桥接层用）
# ======================================
class CoreException(Exception):
    """系统异常基类，所有基础设施层异常必须继承"""
    def __init__(self, message: str, code: ErrorCode = ErrorCode.UNKNOWN):
        self.message = message
        self.code: ErrorCode = code
        super().__init__(f"[{code}] {message}")


class AdapterException(CoreException):
    """适配器层异常，通信/协议转换失败时抛出（错误码归并入 IPC_ERROR）"""
    def __init__(self, message: str):
        super().__init__(message, ErrorCode.IPC_ERROR)


class InferenceException(CoreException):
    """推理层异常，LLM调用失败时抛出"""
    def __init__(self, message: str):
        super().__init__(message, ErrorCode.INFERENCE_ERROR)


class ConfigException(CoreException):
    """配置异常，配置注入/校验失败时抛出"""
    def __init__(self, message: str):
        super().__init__(message, ErrorCode.CONFIG_ERROR)


class BridgeException(CoreException):
    """桥接层异常，与内核通信失败时抛出（错误码归并入 IPC_ERROR）"""
    def __init__(self, message: str):
        super().__init__(message, ErrorCode.IPC_ERROR)


# ======================================
# 领域业务异常基类（领域层/应用层用）
# ======================================
class DomainException(Exception):
    """领域异常基类，所有业务规则异常必须继承"""
    def __init__(self, message: str, code: ErrorCode = ErrorCode.DOMAIN_ERROR):
        self.message = message
        self.code: ErrorCode = code
        super().__init__(f"[{code}] {message}")


class PersonaViolationException(DomainException):
    """人设违反异常，输出内容突破边界红线时抛出"""
    def __init__(self, message: str):
        super().__init__(message, ErrorCode.PERSONA_VIOLATION)


class MemoryNotFoundException(DomainException):
    """记忆不存在异常"""
    def __init__(self, memory_id: str):
        super().__init__(f"记忆不存在: {memory_id}", ErrorCode.MEMORY_NOT_FOUND)


class EmotionException(DomainException):
    """情绪系统异常"""
    def __init__(self, message: str):
        super().__init__(message, ErrorCode.EMOTION_ERROR)
