"""
文件名称：knowledge_repo.py
所属层级：持久化层（Persistence）
核心作用：知识库条目的 SQLite 读写（L3）
设计原则：
1. 知识库是"被给予的"（curated），与"活出来的"记忆在存储层彻底分开
2. 只做数据访问，不含检索策略（检索由领域层 ContextAssembly 负责）
3. activation（激活规则）在库内存为 JSON 文本，进出由本层序列化
"""
from __future__ import annotations

import json
from typing import Any

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase

logger = get_logger("knowledge_repo")


class KnowledgeRepository:
    """知识库条目数据访问层。"""

    def __init__(self, database: CognitionDatabase) -> None:
        self._db = database

    async def upsert_entry(
        self,
        *,
        entry_id: str,
        content: str,
        priority: int = 1,
        enabled: bool = True,
        scope: str = "knowledge",
        source: str = "config",
        activation: dict[str, Any] | None = None,
    ) -> None:
        """新增或覆盖一条知识条目（按 entry_id 幂等）。"""
        await self._db.connection.execute(
            """
            INSERT INTO knowledge_entry
                (entry_id, content, priority, enabled, scope, source, activation_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entry_id) DO UPDATE SET
                content=excluded.content,
                priority=excluded.priority,
                enabled=excluded.enabled,
                scope=excluded.scope,
                source=excluded.source,
                activation_json=excluded.activation_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (entry_id, content, priority, 1 if enabled else 0, scope, source,
             json.dumps(activation or {}, ensure_ascii=False)),
        )
        await self._db.connection.commit()

    async def replace_config_entries(self, entries: list[dict[str, Any]]) -> None:
        """用一批 config 来源的条目，替换库中所有 source='config' 的条目。

        单事务内：删旧 config 条目 → 插新集合。其他来源（未来摄入的知识）不受影响。
        每个 entry 含 entry_id / content / priority / enabled / activation。
        """
        conn = self._db.connection
        await conn.execute("DELETE FROM knowledge_entry WHERE source = 'config'")
        for e in entries:
            await conn.execute(
                """
                INSERT INTO knowledge_entry
                    (entry_id, content, priority, enabled, scope, source, activation_json)
                VALUES (?, ?, ?, ?, 'knowledge', 'config', ?)
                ON CONFLICT(entry_id) DO UPDATE SET
                    content=excluded.content,
                    priority=excluded.priority,
                    enabled=excluded.enabled,
                    scope=excluded.scope,
                    source=excluded.source,
                    activation_json=excluded.activation_json,
                    updated_at=CURRENT_TIMESTAMP
                """,
                (e["entry_id"], e["content"], e.get("priority", 1),
                 1 if e.get("enabled", True) else 0,
                 json.dumps(e.get("activation", {}), ensure_ascii=False)),
            )
        await conn.commit()

    async def get_all_entries(self) -> list[dict[str, Any]]:
        """取全部知识条目（认知核启动时全量加载）。"""
        cursor = await self._db.connection.execute(
            "SELECT entry_id, content, priority, enabled, scope, source, activation_json "
            "FROM knowledge_entry ORDER BY priority DESC"
        )
        rows = await cursor.fetchall()
        return [self._row_to_entry(r) for r in rows]

    async def clear(self) -> None:
        """清空知识库（从配置全量重新预填前使用）。"""
        await self._db.connection.execute("DELETE FROM knowledge_entry")
        await self._db.connection.commit()

    async def count(self) -> int:
        """知识条目条数。"""
        cursor = await self._db.connection.execute("SELECT COUNT(1) FROM knowledge_entry")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0

    @staticmethod
    def _row_to_entry(r: Any) -> dict[str, Any]:
        return {
            "entry_id": r[0],
            "content": r[1],
            "priority": r[2],
            "enabled": bool(r[3]),
            "scope": r[4],
            "source": r[5],
            "activation": json.loads(r[6]) if r[6] else {},
        }
