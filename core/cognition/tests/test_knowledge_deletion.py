from pathlib import Path

import pytest

from glimmer_cradle.cognition.adapters.persistence.sqlite_knowledge_store import (
    SqliteKnowledgeStore,
)


async def test_delete_requires_current_revision_and_removes_active_entry(tmp_path: Path) -> None:
    store = SqliteKnowledgeStore(
        tmp_path / "knowledge.sqlite", legacy_memory_path=tmp_path / "absent.sqlite"
    )
    await store.connect()
    await store.replace_config_entries(
        [{"entry_id": "k1", "content": "可删除知识", "enabled": True}]
    )
    with pytest.raises(RuntimeError, match="revision conflict"):
        await store.delete_entry("k1", expected_revision=0, source="editor")
    with pytest.raises(PermissionError):
        await store.delete_entry("k1", expected_revision=1, source="model")
    assert await store.delete_entry("k1", expected_revision=1, source="editor") == 2
    assert await store.get_all_entries() == []
    await store.close()
