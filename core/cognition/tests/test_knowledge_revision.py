import sqlite3
from pathlib import Path

from glimmer_cradle.cognition.adapters.persistence.sqlite_knowledge_store import (
    SqliteKnowledgeStore,
)
from glimmer_cradle.cognition.knowledge import KnowledgeIndex
from tests.conftest import OBSERVABILITY


def _fresh_knowledge_index() -> KnowledgeIndex:
    return KnowledgeIndex(observability=OBSERVABILITY)


async def test_knowledge_index_loads_enabled_entries_by_priority(
    tmp_path: Path,
) -> None:
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    await store.replace_config_entries([
        {"entry_id": "k1", "content": "月见的世界观", "priority": 5, "enabled": True},
        {"entry_id": "k2", "content": "用户的生日", "priority": 1, "enabled": True},
    ])
    knowledge = _fresh_knowledge_index()
    knowledge.bind_repository(store)
    await knowledge.load_persisted()

    entries = await knowledge.get_knowledge()
    assert [entry.entry_id for entry in entries] == ["k1", "k2"]
    assert {entry.content for entry in entries} == {"月见的世界观", "用户的生日"}
    await store.close()


async def test_knowledge_index_loads_empty_store(tmp_path: Path) -> None:
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    knowledge = _fresh_knowledge_index()
    knowledge.bind_repository(store)
    await knowledge.load_persisted()

    assert knowledge.get_all_entries() == []
    await store.close()


async def test_legacy_memory_knowledge_is_imported_once(tmp_path: Path) -> None:
    legacy_path = tmp_path / "memory.sqlite"
    legacy = sqlite3.connect(legacy_path)
    legacy.execute(
        """
        CREATE TABLE knowledge_entry(
          entry_id TEXT PRIMARY KEY, content TEXT NOT NULL, priority INTEGER NOT NULL,
          enabled INTEGER NOT NULL, source TEXT NOT NULL, activation_json TEXT NOT NULL
        )
        """
    )
    legacy.execute(
        "INSERT INTO knowledge_entry VALUES(?,?,?,?,?,?)",
        ("legacy-1", "旧库知识", 4, 1, "config", '{"keywords":["旧库"]}'),
    )
    legacy.commit()
    legacy.close()

    store = SqliteKnowledgeStore(
        tmp_path / "knowledge.sqlite", legacy_memory_path=legacy_path
    )
    await store.connect()
    assert await store.get_all_entries() == [
        {
            "entry_id": "legacy-1",
            "content": "旧库知识",
            "priority": 4,
            "enabled": True,
            "scope": "knowledge",
            "source": "config",
            "activation": {"keywords": ["旧库"]},
            "revision": 1,
        }
    ]
    await store.close()

    legacy = sqlite3.connect(legacy_path)
    legacy.execute(
        "INSERT INTO knowledge_entry VALUES(?,?,?,?,?,?)",
        ("late", "不得二次导入", 1, 1, "config", "{}"),
    )
    legacy.commit()
    legacy.close()
    await store.connect()
    assert [item["entry_id"] for item in await store.get_all_entries()] == ["legacy-1"]
    await store.close()


async def test_config_update_increments_revision(tmp_path: Path) -> None:
    store = SqliteKnowledgeStore(
        tmp_path / "knowledge.sqlite", legacy_memory_path=tmp_path / "absent.sqlite"
    )
    await store.connect()
    await store.replace_config_entries(
        [{"entry_id": "k1", "content": "第一版", "enabled": True}]
    )
    await store.replace_config_entries(
        [{"entry_id": "k1", "content": "第二版", "enabled": True}]
    )
    entries = await store.get_all_entries()
    await store.close()
    assert entries[0]["revision"] == 2
    assert entries[0]["content"] == "第二版"


async def test_removed_config_entry_can_be_reintroduced_with_next_revision(
    tmp_path: Path,
) -> None:
    store = SqliteKnowledgeStore(
        tmp_path / "knowledge.sqlite", legacy_memory_path=tmp_path / "absent.sqlite"
    )
    await store.connect()
    entry = {"entry_id": "k1", "content": "会恢复", "enabled": True}
    await store.replace_config_entries([entry])
    await store.replace_config_entries([])
    await store.replace_config_entries([entry])
    entries = await store.get_all_entries()
    await store.close()
    assert entries[0]["revision"] == 3
