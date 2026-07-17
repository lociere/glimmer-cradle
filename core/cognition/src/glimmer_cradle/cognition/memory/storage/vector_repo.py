"""
文件名称：vector_repo.py
所属层级：持久化层（Persistence）
核心作用：embedding 向量的 SQLite 读写（L4 向量层）
设计原则：
1. 向量持久化的唯一目的——省去每次启动全量重算 embedding
2. 向量存为 float32 BLOB；相似度计算仍在 Python 侧（numpy），不在 SQL 侧
   —— 当前单机数百条记忆的规模用不上 SQL KNN；规模剧增时再考虑 sqlite-vec
3. 每条向量记录其产出模型；换嵌入模型后，旧模型的向量在加载时被自然忽略 → 重算
"""
from __future__ import annotations

import numpy as np

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase

logger = get_logger("vector_repo")

# 向量统一以 float32 存储
_DTYPE = np.float32


class VectorRepository:
    """embedding 向量数据访问层。owner_kind 取 'memory' / 'knowledge'。"""

    def __init__(self, database: CognitionDatabase) -> None:
        self._db = database

    async def upsert_vector(
        self,
        *,
        owner_kind: str,
        owner_id: str,
        model: str,
        vector: np.ndarray,
    ) -> None:
        """写入或覆盖一条向量（按 owner_kind+owner_id 幂等）。"""
        vec = np.asarray(vector, dtype=_DTYPE).reshape(-1)
        await self._db.connection.execute(
            """
            INSERT INTO embedding (owner_kind, owner_id, model, dim, vector)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_kind, owner_id) DO UPDATE SET
                model=excluded.model,
                dim=excluded.dim,
                vector=excluded.vector,
                updated_at=CURRENT_TIMESTAMP
            """,
            (owner_kind, owner_id, model, int(vec.shape[0]), vec.tobytes()),
        )
        await self._db.connection.commit()

    async def get_vectors(self, owner_kind: str, model: str) -> dict[str, np.ndarray]:
        """取某类目下、由指定模型产出的全部向量。

        返回 {owner_id: 一维 float32 向量}。其他模型产出的向量不返回 ——
        调用方据此对"缺失"的条目重算（换模型即 stale 重算）。
        """
        cursor = await self._db.connection.execute(
            "SELECT owner_id, vector FROM embedding WHERE owner_kind = ? AND model = ?",
            (owner_kind, model),
        )
        rows = await cursor.fetchall()
        return {r[0]: np.frombuffer(r[1], dtype=_DTYPE) for r in rows}

    async def delete_vector(self, owner_kind: str, owner_id: str) -> None:
        """删除一条向量。"""
        await self._db.connection.execute(
            "DELETE FROM embedding WHERE owner_kind = ? AND owner_id = ?",
            (owner_kind, owner_id),
        )
        await self._db.connection.commit()

    async def count(self, owner_kind: str) -> int:
        """某类目下的向量条数。"""
        cursor = await self._db.connection.execute(
            "SELECT COUNT(1) FROM embedding WHERE owner_kind = ?", (owner_kind,)
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0
