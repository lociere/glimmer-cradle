"""基于 UUID 的进程标识符生成 Adapter。"""

import uuid


class SystemIdGenerator:
    def new(self) -> str:
        return uuid.uuid4().hex

    def stable(self, namespace: str, value: str) -> str:
        return uuid.uuid5(uuid.NAMESPACE_URL, f"{namespace}:{value}").hex
