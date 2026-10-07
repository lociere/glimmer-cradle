"""Deterministic Knowledge transformations."""

import hashlib

# 当前配置 intake 的实际转换：trim 后全文为一个索引单元，不宣称已实现资源分块。
KNOWLEDGE_TRANSFORMATION_VERSION = "trim-text/whole-entry.v1"


def content_digest(content: str) -> str:
    return hashlib.sha256(content.strip().encode("utf-8")).hexdigest()
