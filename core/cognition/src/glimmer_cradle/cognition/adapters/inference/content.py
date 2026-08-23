"""
文件名称：multimodal_content.py
所属层级：领域层-多模态模块
核心作用：处理Kernel 内核预处理后的多模态语义内容，AI层仅处理语义文本
设计原则：
1. 仅接收内核预处理后的纯文本语义（图片OCR、语音转文字、视频摘要）
2. 绝对不碰任何媒体文件、不做任何硬算力预处理
3. 仅用于记忆存储和prompt注入，无业务逻辑
"""
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import uuid4
from datetime import datetime


# ======================================
# 多模态内容类型枚举
# ======================================
class MultimodalType(StrEnum):
    IMAGE = "image"   # 图片（内核已做OCR）
    AUDIO = "audio"   # 语音（内核已做STT转文字）
    VIDEO = "video"   # 视频（内核已做帧摘要）
    FILE = "file"     # 文件（内核已做内容解析）


# ======================================
# 多模态内容实体
# ======================================
@dataclass
class MultimodalContent:
    """
    多模态内容实体，由Kernel 内核预处理后传入AI层
    核心规则：仅包含语义文本，不包含二进制媒体文件，AI层仅处理语义
    """
    # 多模态类型
    modal_type: MultimodalType
    # 内核预处理后的语义文本（图片OCR结果、语音转文字、视频摘要等）
    semantic_text: str
    # 内容唯一ID
    content_id: str = field(default_factory=lambda: str(uuid4()))
    # 生成时间
    timestamp: datetime = field(default_factory=datetime.now)
    # 原始文件名称（仅用于日志，不做业务逻辑）
    original_file_name: str = ""

    def get_full_text(self) -> str:
        """
        获取完整的语义文本，用于prompt注入和记忆存储
        返回：格式化后的多模态语义文本
        """
        return f"[{self.modal_type.value}内容] {self.semantic_text}"