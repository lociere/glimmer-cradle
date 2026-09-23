"""知识库通过独立 Knowledge store 持久化。"""
from pathlib import Path

from glimmer_cradle.cognition.knowledge import KnowledgeIndex
from tests.support import OBSERVABILITY
from glimmer_cradle.cognition.adapters.persistence.sqlite_knowledge_store import SqliteKnowledgeStore


def _fresh_kb() -> KnowledgeIndex:
    return KnowledgeIndex(observability=OBSERVABILITY)


async def test_load_persisted_populates_entries(tmp_path: Path) -> None:
    db = SqliteKnowledgeStore(path=tmp_path / "knowledge.sqlite")
    await db.connect()
    try:
        await db.replace_config_entries([
            {"entry_id": "k1", "content": "月见的世界观", "priority": 5, "enabled": True},
            {"entry_id": "k2", "content": "用户的生日", "priority": 1, "enabled": True},
        ])
        kb = _fresh_kb()
        kb.bind_repository(db)
        await kb.load_persisted()

        assert len(kb.get_all_entries()) == 2
        # full_injection 默认策略：get_knowledge 返回全部已启用条目，按优先级降序
        knowledge = await kb.get_knowledge()
        assert knowledge[0].entry_id == "k1"  # priority 5 在前
        assert {e.content for e in knowledge} == {"月见的世界观", "用户的生日"}
    finally:
        await db.close()


async def test_load_persisted_empty(tmp_path: Path) -> None:
    db = SqliteKnowledgeStore(path=tmp_path / "knowledge.sqlite")
    await db.connect()
    try:
        kb = _fresh_kb()
        kb.bind_repository(db)
        await kb.load_persisted()
        assert kb.get_all_entries() == []
    finally:
        await db.close()
