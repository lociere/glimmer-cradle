"""系统生成不透明标识符的外部能力。"""

from typing import Protocol


class IdGeneratorPort(Protocol):
    def new(self) -> str: ...
    def stable(self, namespace: str, value: str) -> str: ...
