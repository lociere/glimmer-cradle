"""向量仓库测试 —— embedding 的 BLOB 持久化、模型过滤、覆盖与删除（批次 2.5）。"""
from pathlib import Path

import numpy as np

from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.vector_repo import VectorRepository


async def _open(tmp_path: Path) -> CognitionDatabase:
    db = CognitionDatabase(db_path=tmp_path / "cognition.db")
    await db.connect()
    return db


async def test_upsert_and_get_vectors(tmp_path: Path) -> None:
    db = await _open(tmp_path)
    try:
        repo = VectorRepository(db)
        await repo.upsert_vector(
            owner_kind="memory", owner_id="m1", model="modelA",
            vector=np.array([1.0, 2.0, 3.0]),
        )
        got = await repo.get_vectors("memory", "modelA")
        assert set(got) == {"m1"}
        assert np.allclose(got["m1"], [1.0, 2.0, 3.0])
        assert await repo.count("memory") == 1
    finally:
        await db.close()


async def test_get_vectors_filters_by_model(tmp_path: Path) -> None:
    """换模型后旧向量应被自然忽略 —— get_vectors 按 model 过滤。"""
    db = await _open(tmp_path)
    try:
        repo = VectorRepository(db)
        await repo.upsert_vector(owner_kind="memory", owner_id="m1", model="modelA",
                                 vector=np.array([1.0]))
        await repo.upsert_vector(owner_kind="memory", owner_id="m2", model="modelB",
                                 vector=np.array([2.0]))
        assert set(await repo.get_vectors("memory", "modelA")) == {"m1"}
        assert set(await repo.get_vectors("memory", "modelB")) == {"m2"}
    finally:
        await db.close()


async def test_upsert_overwrites_and_delete(tmp_path: Path) -> None:
    db = await _open(tmp_path)
    try:
        repo = VectorRepository(db)
        await repo.upsert_vector(owner_kind="knowledge", owner_id="k1", model="m",
                                 vector=np.array([1.0]))
        await repo.upsert_vector(owner_kind="knowledge", owner_id="k1", model="m",
                                 vector=np.array([9.0]))
        got = await repo.get_vectors("knowledge", "m")
        assert np.allclose(got["k1"], [9.0])
        await repo.delete_vector("knowledge", "k1")
        assert await repo.count("knowledge") == 0
    finally:
        await db.close()
