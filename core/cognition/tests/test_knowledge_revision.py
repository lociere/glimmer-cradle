import asyncio
import sqlite3
from pathlib import Path

import numpy as np
import pytest
from glimmer_cradle.cognition.adapters.persistence.sqlite_knowledge_store import (
    SqliteKnowledgeStore,
)
from glimmer_cradle.cognition.context import ContextQuery
from glimmer_cradle.cognition.context.assembler import ReplyContextBuilder
from glimmer_cradle.cognition.context.source import KnowledgeSource
from glimmer_cradle.cognition.knowledge import (
    KnowledgeConflictError,
    KnowledgeIndex,
    KnowledgeRevision,
    content_digest,
)
from glimmer_cradle.cognition.knowledge.retrieval import KnowledgeRetrievalPolicy
from glimmer_cradle.cognition.knowledge.transformation import (
    KNOWLEDGE_TRANSFORMATION_VERSION,
)
from glimmer_cradle.cognition.ports import KnowledgeInitialization
from tests.conftest import OBSERVABILITY


def _fresh_knowledge_index() -> KnowledgeIndex:
    return KnowledgeIndex(observability=OBSERVABILITY)


async def test_knowledge_index_loads_enabled_entries_by_priority(
    tmp_path: Path,
) -> None:
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    await store.replace_config_entries(
        [
            {
                "entry_id": "k1",
                "content": "月见的世界观",
                "priority": 5,
                "enabled": True,
            },
            {"entry_id": "k2", "content": "用户的生日", "priority": 1, "enabled": True},
        ]
    )
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


async def test_knowledge_owner_does_not_implicitly_import_memory(
    tmp_path: Path,
) -> None:
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

    with sqlite3.connect(legacy_path) as connection:
        before = list(connection.iterdump())
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    try:
        assert await store.get_all_entries() == []
    finally:
        await store.close()
    with sqlite3.connect(legacy_path) as connection:
        assert list(connection.iterdump()) == before


async def test_config_update_increments_revision(tmp_path: Path) -> None:
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
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
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    entry = {"entry_id": "k1", "content": "会恢复", "enabled": True}
    await store.replace_config_entries([entry])
    await store.replace_config_entries([])
    await store.replace_config_entries([entry])
    entries = await store.get_all_entries()
    await store.close()
    assert entries[0]["revision"] == 3


class _Embedding:
    model_id = "fixture:embedding:2"

    def __init__(self):
        self.documents = []

    def is_available(self):
        return True

    async def encode(self, texts, *, text_type):
        self.documents.append(list(texts))
        return np.array([[1.0, len(text)] for text in texts], dtype=np.float32)

    async def encode_single(self, text, *, text_type):
        return np.array([1.0, len(text)], dtype=np.float32)

    def cosine_similarities(self, query, matrix):
        return np.ones(len(matrix))


def _indexed(store, embedding):
    index = _fresh_knowledge_index()
    index.bind_repository(store)
    index.set_embedding_engine(embedding)
    index._policy = KnowledgeRetrievalPolicy(mode="semantic_rag", min_score=0)
    return index


def _ref(content="第一版", revision=1, source="config"):
    return KnowledgeRevision("k1", revision, source, content_digest(content))


async def test_revision_bound_vectors_reopen_update_delete_and_reintroduce(tmp_path):
    path = tmp_path / "knowledge.sqlite"
    store = SqliteKnowledgeStore(path)
    await store.connect()
    entry = {"entry_id": "k1", "content": "第一版", "priority": 3, "enabled": True}
    embedding = _Embedding()
    index = _indexed(store, embedding)
    try:
        await store.replace_config_entries([entry])
        assert (await index.get_knowledge("知识"))[0].revision == 1
        assert len(embedding.documents) == 1
        await store.replace_config_entries([entry])
        assert (await index.get_knowledge("知识"))[0].revision == 1
        assert len(embedding.documents) == 1
        await store.close()
        await store.connect()
        reopened = _indexed(store, embedding)
        assert (await reopened.get_knowledge("知识"))[0].content == "第一版"
        assert len(embedding.documents) == 1

        await store.replace_config_entries([{**entry, "content": "第二版"}])
        assert (
            await store.get_embeddings(
                model=embedding.model_id,
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
            )
            == {}
        )
        changed = (await index.get_knowledge("知识"))[0]
        assert changed.revision == 2 and changed.content == "第二版"
        assert len(embedding.documents) == 2
        with pytest.raises(KnowledgeConflictError, match="已失效"):
            await store.upsert_embedding(
                _ref(),
                model=embedding.model_id,
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
                vector=np.ones(2),
            )

        await store.delete_entry("k1", expected_revision=2, source="editor")
        assert await index.get_knowledge("知识") == []
        assert (
            await store.get_embeddings(
                model=embedding.model_id,
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
            )
            == {}
        )
        await store.replace_config_entries([entry])
        restored = (await index.get_knowledge("知识"))[0]
        assert restored.revision == 4 and restored.source == "config"
        with sqlite3.connect(path) as connection:
            assert connection.execute(
                "SELECT source,deleted FROM knowledge_revision ORDER BY revision"
            ).fetchall() == [("config", 0), ("config", 0), ("editor", 1), ("config", 0)]
    finally:
        await store.close()


@pytest.mark.parametrize("change", ["update", "delete"])
@pytest.mark.parametrize("at", ["document", "query"])
async def test_late_embedding_cannot_reexpose_invalidated_content(tmp_path, change, at):
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    await store.replace_config_entries([{"entry_id": "k1", "content": "第一版"}])
    entered, released = asyncio.Event(), asyncio.Event()

    class _PausedEmbedding(_Embedding):
        async def encode(self, texts, *, text_type):
            if at == "document":
                entered.set()
                await released.wait()
            return await super().encode(texts, text_type=text_type)

        async def encode_single(self, text, *, text_type):
            if at == "query":
                entered.set()
                await released.wait()
            return await super().encode_single(text, text_type=text_type)

    index = _indexed(store, _PausedEmbedding())
    if at == "query":
        await index.load_persisted()
    query = asyncio.create_task(index.get_knowledge("第一版"))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        if change == "update":
            await store.replace_config_entries(
                [{"entry_id": "k1", "content": "新版数据"}]
            )
        else:
            await store.delete_entry("k1", expected_revision=1, source="editor")
        released.set()
        assert await query == []
        if at == "document":
            assert (
                await store.get_embeddings(
                    model=_Embedding.model_id,
                    transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
                )
                == {}
            )
        current = await index.get_knowledge("新版数据")
        assert [item.content for item in current] == (
            ["新版数据"] if change == "update" else []
        )
    finally:
        released.set()
        await store.close()


async def test_index_transform_model_identity_and_malformed_batch(tmp_path):
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    await store.replace_config_entries([{"entry_id": "k1", "content": "第一版"}])
    try:
        await store.upsert_embedding(
            _ref(),
            model="fixture:old",
            transformation_version="old-parser",
            vector=np.ones(2),
        )
        assert (
            await store.get_embeddings(
                model="fixture:new", transformation_version="old-parser"
            )
            == {}
        )
        assert (
            await store.get_embeddings(
                model="fixture:old",
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
            )
            == {}
        )

        class _InvalidEmbedding(_Embedding):
            async def encode(self, texts, *, text_type):
                return np.array([[np.nan, 1], [1, 2]])

        index = _indexed(store, _InvalidEmbedding())
        assert [item.content for item in await index.get_knowledge("第一版")] == [
            "第一版"
        ]
        assert (
            await store.get_embeddings(
                model=_Embedding.model_id,
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
            )
            == {}
        )
        for vector in (
            np.array([]),
            np.array([[1.0]]),
            np.array([np.inf]),
            np.array([1 + 2j]),
        ):
            with pytest.raises(KnowledgeConflictError):
                await store.upsert_embedding(
                    _ref(),
                    model="fixture:new",
                    transformation_version="v1",
                    vector=vector,
                )
    finally:
        await store.close()


@pytest.mark.parametrize(
    "failure", ["owner", "version", "unversioned", "partial", "columns"]
)
async def test_unsupported_knowledge_store_is_not_implicitly_repaired(
    tmp_path, failure
):
    path = tmp_path / "knowledge.sqlite"
    store = SqliteKnowledgeStore(path)
    await store.connect()
    await store.replace_config_entries([{"entry_id": "k1", "content": "不可再生正文"}])
    await store.close()
    with sqlite3.connect(path) as connection:
        if failure == "owner":
            connection.execute("PRAGMA application_id=123")
        elif failure == "version":
            connection.execute("PRAGMA user_version=999")
        elif failure == "unversioned":
            connection.execute("PRAGMA application_id=0")
            connection.execute("PRAGMA user_version=0")
        elif failure == "columns":
            connection.execute(
                "ALTER TABLE knowledge_entry RENAME COLUMN content_digest TO missing_digest"
            )
        else:
            connection.execute("DROP TABLE knowledge_embedding")
        before = list(connection.iterdump())
        headers = (
            connection.execute("PRAGMA application_id").fetchone(),
            connection.execute("PRAGMA user_version").fetchone(),
        )
    for _ in range(2):
        with pytest.raises(KnowledgeConflictError, match="受控"):
            await store.connect()
        assert store._connection is None
    with sqlite3.connect(path) as connection:
        assert list(connection.iterdump()) == before
        assert headers == (
            connection.execute("PRAGMA application_id").fetchone(),
            connection.execute("PRAGMA user_version").fetchone(),
        )


async def test_source_and_vector_mutations_share_cancelled_transaction_boundary(
    tmp_path, monkeypatch
):
    path = tmp_path / "knowledge.sqlite"
    store = SqliteKnowledgeStore(path)
    await store.connect()
    await store.replace_config_entries([{"entry_id": "k1", "content": "第一版"}])
    inserted, rollback_entered, release = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    connection = store._conn
    original_write, original_rollback = store._write_revision, connection.rollback

    async def paused_write(*args, **kwargs):
        await original_write(*args, **kwargs)
        inserted.set()
        await asyncio.Event().wait()

    async def paused_rollback():
        rollback_entered.set()
        await release.wait()
        await original_rollback()

    monkeypatch.setattr(store, "_write_revision", paused_write)
    monkeypatch.setattr(connection, "rollback", paused_rollback)
    write = asyncio.create_task(
        store.replace_config_entries([{"entry_id": "k1", "content": "半提交正文"}])
    )
    await asyncio.wait_for(inserted.wait(), 2)
    vector = asyncio.create_task(
        store.upsert_embedding(
            _ref(), model="fixture", transformation_version="v1", vector=np.ones(2)
        )
    )
    read = asyncio.create_task(store.get_all_entries())
    write.cancel()
    await asyncio.wait_for(rollback_entered.wait(), 2)
    write.cancel()
    await asyncio.sleep(0)
    assert not read.done() and not vector.done() and not write.done()
    with sqlite3.connect(path) as observer:
        assert (
            observer.execute("SELECT content FROM knowledge_entry").fetchone()[0]
            == "第一版"
        )
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await write
    await vector
    assert (await read)[0]["content"] == "第一版"
    monkeypatch.setattr(store, "_write_revision", original_write)
    await store.replace_config_entries([{"entry_id": "k1", "content": "新提交正文"}])
    assert (await store.get_all_entries())[0]["revision"] == 2
    await store.close()


async def test_double_connection_updates_do_not_read_revision_before_write_lock(
    tmp_path,
):
    path = tmp_path / "knowledge.sqlite"
    first, second = SqliteKnowledgeStore(path), SqliteKnowledgeStore(path)
    await first.connect()
    await second.connect()
    try:
        await asyncio.gather(
            first.replace_config_entries([{"entry_id": "k1", "content": "并发来源"}]),
            second.replace_config_entries([{"entry_id": "k1", "content": "并发来源"}]),
        )
        assert (await first.get_all_entries())[0]["revision"] == 1
        await asyncio.gather(
            first.replace_config_entries([{"entry_id": "k1", "content": "另一个版本"}]),
            second.replace_config_entries(
                [{"entry_id": "k1", "content": "第三个版本"}]
            ),
        )
        assert (await first.get_all_entries())[0]["revision"] == 3
    finally:
        await first.close()
        await second.close()

def _reference(content="原文", revision=1):
    return KnowledgeRevision("k1", revision, "config", content_digest(content))


async def _seed(path):
    store = SqliteKnowledgeStore(path)
    await store.connect()
    await store.replace_config_entries([{"entry_id": "k1", "content": "原文"}])
    await store.upsert_embedding(
        _reference(), model="fixture:2", transformation_version="v1", vector=np.ones(2)
    )
    return store


@pytest.mark.parametrize("cancelled", [False, True])
async def test_initialization_failure_does_not_publish_partial_owner(
    tmp_path, monkeypatch, cancelled
):
    path = tmp_path / "knowledge.sqlite"
    store = SqliteKnowledgeStore(path)
    original_verify = store._verify_schema
    entered = asyncio.Event()

    async def fail_after_ddl(connection):
        await original_verify(connection)
        entered.set()
        if cancelled:
            await asyncio.Event().wait()
        raise RuntimeError("fault after DDL")

    monkeypatch.setattr(store, "_verify_schema", fail_after_ddl)
    initialize = asyncio.create_task(store.connect())
    await asyncio.wait_for(entered.wait(), 2)
    if cancelled:
        initialize.cancel()
    with pytest.raises(asyncio.CancelledError if cancelled else RuntimeError):
        await initialize
    assert store._connection is None
    with sqlite3.connect(path) as observer:
        assert (
            observer.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
            == []
        )
        assert observer.execute("PRAGMA application_id").fetchone() == (0,)
        assert observer.execute("PRAGMA user_version").fetchone() == (0,)
    monkeypatch.setattr(store, "_verify_schema", original_verify)
    await store.connect()
    assert await store.get_all_entries() == []
    await store.close()


async def test_two_first_connections_share_initialization_owner(tmp_path, monkeypatch):
    path = tmp_path / "knowledge.sqlite"
    first, second = SqliteKnowledgeStore(path), SqliteKnowledgeStore(path)
    original_verify = first._verify_schema
    entered, released = asyncio.Event(), asyncio.Event()

    async def paused_verify(connection):
        await original_verify(connection)
        entered.set()
        await released.wait()

    monkeypatch.setattr(first, "_verify_schema", paused_verify)
    initialize = asyncio.create_task(first.connect())
    await asyncio.wait_for(entered.wait(), 2)
    other = asyncio.create_task(second.connect())
    await asyncio.sleep(0)
    released.set()
    try:
        await asyncio.gather(initialize, other)
        await first.replace_config_entries(
            [{"entry_id": "k1", "content": "并发首次启动"}]
        )
        assert (await second.get_all_entries())[0]["revision"] == 1
    finally:
        released.set()
        await first.close()
        await second.close()


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO knowledge_revision",
        "INSERT INTO knowledge_entry",
        "DELETE FROM knowledge_embedding",
    ],
)
async def test_partial_source_and_invalidation_writes_roll_back_together(
    tmp_path, monkeypatch, statement
):
    store = await _seed(tmp_path / "knowledge.sqlite")
    original_execute = store._conn.execute

    async def fail_after_write(sql, *args, **kwargs):
        cursor = await original_execute(sql, *args, **kwargs)
        if sql.startswith(statement):
            raise sqlite3.OperationalError("injected write failure")
        return cursor

    monkeypatch.setattr(store._conn, "execute", fail_after_write)
    try:
        with pytest.raises(sqlite3.OperationalError):
            await store.replace_config_entries(
                [{"entry_id": "k1", "content": "不可提交正文"}]
            )
        assert (await store.get_all_entries())[0]["content"] == "原文"
        vectors = await store.get_embeddings(
            model="fixture:2", transformation_version="v1"
        )
        assert list(vectors) == [_reference()]
        with sqlite3.connect(store._path) as observer:
            assert observer.execute(
                "SELECT revision FROM knowledge_revision"
            ).fetchall() == [(1,)]
    finally:
        await store.close()


async def test_cancelled_commit_reply_does_not_duplicate_accepted_revision(
    tmp_path, monkeypatch
):
    store = await _seed(tmp_path / "knowledge.sqlite")
    original_commit = store._conn.commit
    committed = asyncio.Event()

    async def lost_reply():
        await original_commit()
        committed.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(store._conn, "commit", lost_reply)
    write = asyncio.create_task(
        store.replace_config_entries([{"entry_id": "k1", "content": "已提交正文"}])
    )
    await asyncio.wait_for(committed.wait(), 2)
    write.cancel()
    with pytest.raises(asyncio.CancelledError):
        await write
    monkeypatch.setattr(store._conn, "commit", original_commit)
    try:
        assert (await store.get_all_entries())[0]["revision"] == 2
        assert (
            await store.get_embeddings(model="fixture:2", transformation_version="v1")
            == {}
        )
        await store.replace_config_entries(
            [{"entry_id": "k1", "content": "已提交正文"}]
        )
        assert (await store.get_all_entries())[0]["revision"] == 2
    finally:
        await store.close()


async def test_failed_rollback_revokes_connection_and_reopen_recovers_original(
    tmp_path, monkeypatch
):
    store = await _seed(tmp_path / "knowledge.sqlite")
    original_write = store._write_revision

    async def failed_write(*args, **kwargs):
        await original_write(*args, **kwargs)
        raise RuntimeError("source write interrupted")

    async def failed_rollback():
        raise sqlite3.OperationalError("rollback unavailable")

    monkeypatch.setattr(store, "_write_revision", failed_write)
    monkeypatch.setattr(store._conn, "rollback", failed_rollback)
    with pytest.raises(BaseExceptionGroup, match="连接已撤销") as failure:
        await store.replace_config_entries(
            [{"entry_id": "k1", "content": "半提交正文"}]
        )
    assert len(failure.value.exceptions) == 2
    assert store._connection is None
    with pytest.raises(RuntimeError, match="not connected"):
        await store.get_all_entries()
    monkeypatch.setattr(store, "_write_revision", original_write)
    await store.connect()
    try:
        assert (await store.get_all_entries())[0]["content"] == "原文"
        assert list(
            await store.get_embeddings(model="fixture:2", transformation_version="v1")
        ) == [_reference()]
    finally:
        await store.close()


async def test_repeated_close_cancellation_drains_connection_before_reopen(
    tmp_path, monkeypatch
):
    store = await _seed(tmp_path / "knowledge.sqlite")
    connection = store._conn
    original_close = connection.close
    entered, released = asyncio.Event(), asyncio.Event()

    async def paused_close():
        entered.set()
        await released.wait()
        await original_close()

    monkeypatch.setattr(connection, "close", paused_close)
    closing = asyncio.create_task(store.close())
    await asyncio.wait_for(entered.wait(), 2)
    closing.cancel()
    await asyncio.sleep(0)
    closing.cancel()
    reopening = asyncio.create_task(store.connect())
    await asyncio.sleep(0)
    assert not closing.done() and not reopening.done()
    released.set()
    with pytest.raises(asyncio.CancelledError):
        await closing
    await reopening
    assert store._conn is not connection
    assert (await store.get_all_entries())[0]["content"] == "原文"
    await store.close()


class _EmptyMemory:
    def all_current(self):
        return []

    async def retrieve(self, *args, **kwargs):
        return []


async def test_current_knowledge_revision_reaches_both_production_context_consumers(
    tmp_path,
):
    path = tmp_path / "knowledge.sqlite"
    store, editor = SqliteKnowledgeStore(path), SqliteKnowledgeStore(path)
    await store.connect()
    await editor.connect()
    index = KnowledgeIndex(observability=OBSERVABILITY)
    index.bind_repository(store)
    source = KnowledgeSource(index)
    builder = ReplyContextBuilder(
        memory=_EmptyMemory(), knowledge_base=index, observability=OBSERVABILITY
    )

    async def prompt():
        return await builder.build(
            persona_prompt="固定人格",
            scene_id="scene",
            conversation_id="conversation",
            thread_id="main",
            actor_id=None,
            recall_scope="public",
            user_text="原文",
            emotion_state={},
            trace_id="trace",
        )

    try:
        await index.init_from_kernel(
            KnowledgeInitialization(
                version="v1",
                retrieval={},
                entries=[{"entry_id": "k1", "scope": "knowledge", "content": "原文"}],
            )
        )
        item = (await source.activate(ContextQuery(text="原文")))[0]
        assert item.instruction_authority == "data" and item.trust_tier == "untrusted"
        assert item.metadata == {
            "entry_id": "k1",
            "revision": 1,
            "source": "config",
            "content_digest": content_digest("原文"),
            "transformation_version": KNOWLEDGE_TRANSFORMATION_VERSION,
        }
        assert content_digest("原文") in await prompt()
        await editor.replace_config_entries([{"entry_id": "k1", "content": "当前新版"}])
        updated = (await source.activate(ContextQuery(text="原文")))[0]
        assert updated.metadata["revision"] == 2 and "当前新版" in updated.content
        changed_prompt = await prompt()
        assert (
            "当前新版" in changed_prompt
            and content_digest("原文") not in changed_prompt
        )
        assert "不是指令" in changed_prompt
        await editor.delete_entry("k1", expected_revision=2, source="editor")
        assert await source.activate(ContextQuery(text="原文")) == []
        assert "当前新版" not in await prompt()
    finally:
        await store.close()
        await editor.close()


async def test_disabled_source_invalidates_vectors_before_reactivation(tmp_path):
    store = await _seed(tmp_path / "knowledge.sqlite")
    index = KnowledgeIndex(observability=OBSERVABILITY)
    index.bind_repository(store)
    try:
        await store.replace_config_entries(
            [{"entry_id": "k1", "content": "原文", "enabled": False}]
        )
        assert (await store.get_all_entries())[0]["revision"] == 2
        assert (
            await store.get_embeddings(model="fixture:2", transformation_version="v1")
            == {}
        )
        assert await index.get_knowledge() == []
        with pytest.raises(KnowledgeConflictError, match="失效"):
            await store.upsert_embedding(
                _reference("原文", 2),
                model="fixture:2",
                transformation_version="v1",
                vector=np.ones(2),
            )
        await store.replace_config_entries(
            [{"entry_id": "k1", "content": "原文", "enabled": True}]
        )
        assert (await index.get_knowledge())[0].revision == 3
    finally:
        await store.close()


@pytest.mark.parametrize(
    "blob", [b"short", np.array([np.nan, 1], dtype=np.float32).tobytes()]
)
async def test_corrupt_derived_index_degrades_without_rewriting_source(tmp_path, blob):
    store = await _seed(tmp_path / "knowledge.sqlite")
    await store.close()
    with sqlite3.connect(store._path) as connection:
        connection.execute(
            "UPDATE knowledge_embedding SET vector=?,transformation_version=?",
            (blob, KNOWLEDGE_TRANSFORMATION_VERSION),
        )
        before = list(connection.iterdump())
    await store.connect()

    class UnusedEmbedding:
        model_id = "fixture:2"

        def is_available(self):
            return True

        async def encode(self, *args, **kwargs):
            pytest.fail("损坏派生索引不能隐式覆盖来源或修复存储")

    index = KnowledgeIndex(observability=OBSERVABILITY)
    index.bind_repository(store)
    index.set_embedding_engine(UnusedEmbedding())
    index._policy = KnowledgeRetrievalPolicy(mode="semantic_rag", min_score=0)
    try:
        assert [entry.content for entry in await index.get_knowledge("原文")] == [
            "原文"
        ]
        with sqlite3.connect(store._path) as connection:
            assert list(connection.iterdump()) == before
    finally:
        await store.close()


async def test_partial_index_failure_keeps_unindexed_valid_source_retrievable(tmp_path):
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    await store.replace_config_entries(
        [
            {"entry_id": "k1", "content": "原文"},
            {"entry_id": "k2", "content": "未编码有效正文"},
        ]
    )

    class PartialEmbedding:
        model_id = "fixture:2"

        def is_available(self):
            return True

        async def encode(self, *args, **kwargs):
            raise RuntimeError("provider unavailable")

        async def encode_single(self, *args, **kwargs):
            pytest.fail("部分索引失败应全量降级，不忽略未索引条目")

    index = KnowledgeIndex(observability=OBSERVABILITY)
    index.bind_repository(store)
    index.set_embedding_engine(PartialEmbedding())
    index._policy = KnowledgeRetrievalPolicy(mode="semantic_rag", min_score=0)
    await store.upsert_embedding(
        _reference(),
        model="fixture:2",
        transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
        vector=np.ones(2),
    )
    try:
        assert [
            item.entry_id for item in await index.get_knowledge("未编码有效正文")
        ] == ["k2", "k1"]
    finally:
        await store.close()


async def _v1_fixture(path):
    store = await _seed(path)
    await store.close()
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE knowledge_resource_revision")
        connection.execute("DROP TABLE knowledge_resource_source")
        connection.execute("PRAGMA user_version=1")
    return store


async def test_v1_requires_explicit_backup_migration_and_preserves_history_vectors(tmp_path):
    path, backup_path = tmp_path / "knowledge.sqlite", tmp_path / "backups" / "knowledge-v1.sqlite"
    store = await _v1_fixture(path)
    with sqlite3.connect(path) as connection:
        original = list(connection.iterdump())
    with pytest.raises(KnowledgeConflictError, match="受控"):
        await store.connect()
    with sqlite3.connect(path) as connection:
        assert list(connection.iterdump()) == original
    await store.migrate_v1(backup_path=backup_path)
    with sqlite3.connect(backup_path) as connection:
        assert list(connection.iterdump()) == original
        assert connection.execute("PRAGMA user_version").fetchone() == (1,)
    await store.connect()
    try:
        assert (await store.get_all_entries())[0]["content"] == "原文"
        assert list(await store.get_embeddings(model="fixture:2", transformation_version="v1")) == [_reference()]
        with pytest.raises(KnowledgeConflictError, match="关闭"):
            await store.migrate_v1(backup_path=tmp_path / "unexpected.sqlite")
    finally:
        await store.close()
    with pytest.raises(KnowledgeConflictError, match="新的独立路径"):
        await store.migrate_v1(backup_path=backup_path)
    with pytest.raises(KnowledgeConflictError, match="v1 owner"):
        await store.migrate_v1(backup_path=tmp_path / "second.sqlite")
    assert not (tmp_path / "second.sqlite").exists()


@pytest.mark.parametrize("failure", ["missing_table", "missing_columns"])
async def test_partial_v1_migration_rolls_back_without_losing_recoverable_backup(tmp_path, failure):
    path, backup_path = tmp_path / "knowledge.sqlite", tmp_path / "backup.sqlite"
    store = await _v1_fixture(path)
    with sqlite3.connect(path) as connection:
        original = list(connection.iterdump())
    migration = tmp_path / "incomplete.sql"
    sql = "CREATE TABLE knowledge_resource_source (source_id TEXT PRIMARY KEY, revision INTEGER, declaration_json TEXT);\n"
    if failure == "missing_columns":
        sql += "CREATE TABLE knowledge_resource_revision (entry_id TEXT PRIMARY KEY);\n"
    migration.write_text(sql, encoding="utf-8")
    broken = SqliteKnowledgeStore(path, migration_path=migration)
    with pytest.raises((KnowledgeConflictError, sqlite3.DatabaseError)):
        await broken.migrate_v1(backup_path=backup_path)
    with sqlite3.connect(path) as connection:
        assert list(connection.iterdump()) == original
        assert connection.execute("PRAGMA user_version").fetchone() == (1,)
    with sqlite3.connect(backup_path) as connection:
        assert list(connection.iterdump()) == original
    await store.migrate_v1(backup_path=tmp_path / "retry-backup.sqlite")
    await store.connect()
    assert (await store.get_all_entries())[0]["revision"] == 1
    await store.close()


@pytest.mark.parametrize("failure", ["owner", "version", "columns", "backup", "same_path"])
async def test_v1_migration_refuses_invalid_owner_or_destructive_backup(tmp_path, failure):
    path, backup = tmp_path / "knowledge.sqlite", tmp_path / "backup.sqlite"
    store = await _v1_fixture(path)
    with sqlite3.connect(path) as connection:
        if failure == "owner":
            connection.execute("PRAGMA application_id=123")
        elif failure == "version":
            connection.execute("PRAGMA user_version=999")
        elif failure == "columns":
            connection.execute("ALTER TABLE knowledge_revision RENAME COLUMN source TO missing_source")
        before = list(connection.iterdump())
    if failure == "backup":
        backup.write_bytes(b"existing recovery material")
    elif failure == "same_path":
        backup = path
    with pytest.raises((KnowledgeConflictError, sqlite3.DatabaseError)):
        await store.migrate_v1(backup_path=backup)
    with sqlite3.connect(path) as connection:
        assert list(connection.iterdump()) == before
    if failure == "backup":
        assert backup.read_bytes() == b"existing recovery material"
    elif failure != "same_path":
        assert not backup.exists()


async def test_cancelled_v1_migration_drains_thread_before_releasing_owner(tmp_path, monkeypatch):
    from threading import Event

    store = await _v1_fixture(tmp_path / "knowledge.sqlite")
    entered, release = Event(), Event()
    original = store._migrate_v1
    def paused(backup):
        entered.set()
        if not release.wait(5):
            raise RuntimeError("fixture release timeout")
        original(backup)
    monkeypatch.setattr(store, "_migrate_v1", paused)
    migrating = asyncio.create_task(store.migrate_v1(backup_path=tmp_path / "backup.sqlite"))
    assert await asyncio.to_thread(entered.wait, 2)
    migrating.cancel()
    opening = asyncio.create_task(store.connect())
    await asyncio.sleep(0)
    migrating.cancel()
    assert not migrating.done() and not opening.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await migrating
    await opening
    assert (await store.get_all_entries())[0]["content"] == "原文"
    await store.close()
