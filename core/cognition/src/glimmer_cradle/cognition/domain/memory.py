"""长期记忆内部分类。"""

from enum import StrEnum


class MemoryKind(StrEnum):
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    SOCIAL = "social"
    AUTOBIOGRAPHICAL = "autobiographical"
    PROSPECTIVE = "prospective"
    PROCEDURAL = "procedural"
