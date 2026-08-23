"""系统时钟 Adapter。"""

import asyncio
import time
from datetime import datetime, timezone


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def now_iso(self) -> str:
        return self.now().isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def monotonic(self) -> float:
        return time.monotonic()

    async def wait(self, seconds: float) -> None:
        await asyncio.sleep(seconds)
