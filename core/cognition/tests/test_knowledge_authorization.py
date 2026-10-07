import asyncio
import hashlib
import sqlite3
from dataclasses import replace

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
    require_authorized_source,
)
from glimmer_cradle.cognition.knowledge.ingestion import resource_capture_from
from glimmer_cradle.cognition.knowledge.retrieval import KnowledgeRetrievalPolicy
from glimmer_cradle.cognition.knowledge.source import KnowledgeResourceSource
from glimmer_cradle.cognition.knowledge.transformation import (
    KNOWLEDGE_TRANSFORMATION_VERSION,
)
from glimmer_cradle.cognition.ports import (
    ResourceAccess,
    ResourceScope,
    ResourceSnapshot,
)
from tests.conftest import OBSERVABILITY


def test_model_and_memory_cannot_mutate_curated_knowledge() -> None:
    require_authorized_source("config")
    require_authorized_source("editor")
    with pytest.raises(PermissionError):
        require_authorized_source("model")
    with pytest.raises(PermissionError):
        require_authorized_source("memory")


PRIVATE = ResourceScope("provider", "scene", "conversation")


class _Resource:
    def __init__(self):
        self.now, self.reads, self.current = 100, 0, True
        self.content, self.media = b"Resource reference material", "text/plain"
        self.fail = False

    async def read(self, resource_id, *, source_id, definition_revision, principal_id, scope):
        self.reads += 1
        return ResourceSnapshot(resource_id, hashlib.sha256(self.content).hexdigest(), self.media, self.content,
            {"definition_revision": definition_revision},
            ResourceAccess(f"access:{self.reads}", source_id, principal_id, "permission:1", self.now, self.now + 100))

    async def is_current(self, snapshot, *, principal_id, scope):
        if self.fail:
            raise ConnectionError("Host unavailable")
        access = snapshot.access
        return self.current and access.principal_id == principal_id and access.access_id == f"access:{self.reads}" and self.now < access.expires_at_ms


async def _resource_index(tmp_path, *, scope=PRIVATE):
    store = SqliteKnowledgeStore(tmp_path / "knowledge.sqlite")
    await store.connect()
    resource = _Resource()
    index = KnowledgeIndex(observability=OBSERVABILITY)
    index.bind_repository(store)
    index.bind_resource_port(resource, principal_id="cognition:1")
    source = KnowledgeResourceSource("source:manual", "document", "definition:1", scope, 4)
    await index.register_resource_source(source)
    return store, resource, index, source


async def test_explicit_resource_capture_reopens_with_provenance_and_two_context_consumers(tmp_path):
    store, resource, index, source = await _resource_index(tmp_path)
    try:
        with pytest.raises(KeyError):
            await index.collect_resource("model-invented")
        assert resource.reads == 0 and await store.get_all_entries() == []
        accepted = await index.collect_resource(source.source_id)
        assert accepted.entry_id == source.entry_id and accepted.source == "resource" and accepted.revision == 1
        assert await index.get_knowledge() == []
        assert await index.get_knowledge(scope=ResourceScope("provider", "scene", "other")) == []
        entry = (await index.get_knowledge(scope=PRIVATE))[0]
        assert entry.content == resource.content.decode() and index.get_all_entries() == []
        await store.close()
        await store.connect()
        assert (await index.get_knowledge(scope=PRIVATE))[0].revision == 1
        items = await KnowledgeSource(index).activate(ContextQuery("material", scene_id="scene",
            conversation_id="conversation", source_provider_id="provider"))
        assert items[0].instruction_authority == "data" and items[0].trust_tier == "untrusted"
        assert items[0].metadata["source_id"] == source.source_id
        assert items[0].metadata["parser_version"] == "utf8-trim-text.v1"
        assert items[0].metadata["chunk_version"] == "whole-resource.v1"
        assert items[0].metadata["freshness"] == "current" and "access_id" not in items[0].metadata
        builder = ReplyContextBuilder(knowledge_base=index, observability=OBSERVABILITY)
        arguments = dict(persona_prompt="fixed persona", scene_id="scene", conversation_id="conversation",
            thread_id="main", actor_id=None, recall_scope="conversation_private", user_text="material",
            emotion_state={}, trace_id="trace")
        assert "Resource reference material" not in await builder.build(**arguments)
        assert "Resource reference material" in await builder.build(**arguments, source_provider_id="provider")
        assert "Resource reference material" not in await builder.build(**{**arguments, "conversation_id": "other"}, source_provider_id="provider")
        index.bind_resource_port(resource, principal_id="cognition:2")
        assert await index.get_knowledge(scope=PRIVATE) == []
        await index.collect_resource(source.source_id)
        assert (await index.get_knowledge(scope=PRIVATE))[0].revision == 2
    finally:
        await store.close()


async def test_global_collection_does_not_require_invented_conversation(tmp_path):
    store, resource, index, source = await _resource_index(tmp_path, scope=ResourceScope())
    try:
        await index.collect_resource(source.source_id)
        assert len(await index.get_knowledge(scope=ResourceScope())) == 1
        assert len(await index.get_knowledge(scope=PRIVATE)) == 1
        assert await index.get_knowledge(scope=ResourceScope("partial")) == []
        assert await index.get_knowledge(scope=ResourceScope("", "", "")) == []
        assert len(await KnowledgeSource(index).activate(ContextQuery("material"))) == 1
        assert await KnowledgeSource(index).activate(ContextQuery("material", scene_id="partial")) == []
        assert resource.reads == 1  # 检索只复验，不隐式重读或保存。
    finally:
        await store.close()


async def test_resource_material_is_not_cached_in_unscoped_workspace_attention(tmp_path):
    from glimmer_cradle.cognition.attention import make_attention
    from glimmer_cradle.cognition.context import ContextAssembler
    from glimmer_cradle.cognition.loop import MemoryProvider
    from tests.conftest import CLOCK, IDS

    store, resource, index, source = await _resource_index(tmp_path)
    try:
        await index.collect_resource(source.source_id)
        provider = MemoryProvider(ContextAssembler([KnowledgeSource(index)], observability=OBSERVABILITY), clock=CLOCK, ids=IDS)
        focus = make_attention(source="perception", content={"text": "material", "source_provider_id": "provider",
            "scene_id": "scene", "conversation_id": "conversation"}, salience=1, clock=CLOCK, ids=IDS)
        assert await provider.propose([focus]) == []
        assert resource.current
    finally:
        await store.close()


@pytest.mark.parametrize("reason", ["revoke", "expire", "unavailable", "delete", "update"])
async def test_resource_invalidates_vectors_and_context_without_cached_fallback(tmp_path, reason):
    store, resource, index, source = await _resource_index(tmp_path)
    try:
        reference = await index.collect_resource(source.source_id)
        await store.upsert_embedding(reference, model="fixture", transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION, vector=np.ones(2))
        assert len(await index.get_knowledge(scope=PRIVATE)) == 1
        if reason == "revoke":
            resource.current = False
        elif reason == "expire":
            resource.now = 200
        elif reason == "unavailable":
            resource.fail = True
        elif reason == "delete":
            await store.delete_entry(source.entry_id, expected_revision=1, source="editor")
        else:
            await index.register_resource_source(replace(source, definition_revision="definition:2"), expected_revision=1)
        assert await index.get_knowledge(scope=PRIVATE) == []
        assert await store.get_embeddings(model="fixture", transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION) == {}
        assert await store.get_all_entries() == []
        with sqlite3.connect(store._path) as observer:
            assert observer.execute("SELECT raw_content FROM knowledge_resource_revision").fetchall() == [(resource.content,)]
            assert observer.execute("SELECT revision FROM knowledge_revision ORDER BY revision").fetchall() == [(1,), (2,)]
        resource.current, resource.fail, resource.now = True, False, 100
        assert await index.get_knowledge(scope=PRIVATE) == []  # 不能以回拨/恢复连通复活 tombstone。
        await index.collect_resource(source.source_id)
        assert (await index.get_knowledge(scope=PRIVATE))[0].revision == 3
    finally:
        await store.close()


@pytest.mark.parametrize("at", ["document", "query"])
async def test_permission_revoked_during_embedding_cannot_enter_context(tmp_path, at):
    store, resource, index, source = await _resource_index(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()

    class _Embedding:
        model_id = "fixture"
        def is_available(self): return True
        async def encode(self, texts, *, text_type):
            if at == "document":
                entered.set()
                await release.wait()
            return np.ones((len(texts), 2))
        async def encode_single(self, text, *, text_type):
            entered.set()
            await release.wait()
            return np.ones(2)
        def cosine_similarities(self, query, matrix): return np.ones(len(matrix))

    try:
        await index.collect_resource(source.source_id)
        index.set_embedding_engine(_Embedding())
        index._policy = KnowledgeRetrievalPolicy(mode="semantic_rag", min_score=0)
        if at == "query":
            await store.upsert_embedding((await index.collect_resource(source.source_id)), model="fixture",
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION, vector=np.ones(2))
        retrieval = asyncio.create_task(index.get_knowledge("material", scope=PRIVATE))
        await asyncio.wait_for(entered.wait(), 2)
        resource.current = False
        release.set()
        assert await retrieval == []
        assert await store.get_embeddings(model="fixture", transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION) == {}
    finally:
        release.set()
        await store.close()


async def test_revocation_after_source_commit_keeps_history_but_not_usable_material(tmp_path, monkeypatch):
    store, resource, index, source = await _resource_index(tmp_path)
    original = store.upsert_resource_entry
    async def revoke_after_write(*args, **kwargs):
        result = await original(*args, **kwargs)
        resource.current = False
        return result
    monkeypatch.setattr(store, "upsert_resource_entry", revoke_after_write)
    try:
        with pytest.raises(PermissionError, match="during acceptance"):
            await index.collect_resource(source.source_id)
        assert await store.get_all_entries() == [] and await index.get_knowledge(scope=PRIVATE) == []
    finally:
        await store.close()


async def test_resource_intent_and_entry_cas_reject_late_collection_and_config_collision(tmp_path, monkeypatch):
    store, resource, index, source = await _resource_index(tmp_path)
    editor = SqliteKnowledgeStore(store._path)
    await editor.connect()
    try:
        snapshot = await resource.read(source.resource_id, source_id=source.source_id,
            definition_revision=source.definition_revision, principal_id="cognition:1", scope=PRIVATE)
        capture = resource_capture_from(source, snapshot)
        await editor.register_resource_source(replace(source, priority=3), expected_revision=1)
        with pytest.raises(KnowledgeConflictError, match="source revision"):
            await store.upsert_resource_entry(capture, expected_source_revision=1, expected_entry_revision=0)
        assert await store.get_all_entries() == []
        await index.collect_resource(source.source_id)
        with pytest.raises(KnowledgeConflictError, match="另一"):
            await editor.replace_config_entries([{"entry_id": source.entry_id, "content": "config replacement"}])
        with pytest.raises(KnowledgeConflictError):
            await index.register_resource_source(source, expected_revision=1)
        await editor.replace_config_entries([{"entry_id": "resource:config", "content": "config"}])
        with pytest.raises(KnowledgeConflictError, match="另一"):
            await index.register_resource_source(replace(source, source_id="config"))
    finally:
        await editor.close()
        await store.close()


@pytest.mark.parametrize("statement", ["INSERT INTO knowledge_resource_revision", "INSERT INTO knowledge_resource_source"])
async def test_resource_capture_or_declaration_failure_rolls_back_with_vector_invalidation(tmp_path, monkeypatch, statement):
    store, resource, index, source = await _resource_index(tmp_path)
    try:
        reference = await index.collect_resource(source.source_id)
        await store.upsert_embedding(reference, model="fixture", transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION, vector=np.ones(2))
        execute = store._conn.execute
        async def fail_after_write(sql, *args, **kwargs):
            cursor = await execute(sql, *args, **kwargs)
            if sql.startswith(statement):
                raise sqlite3.OperationalError("injected resource write failure")
            return cursor
        monkeypatch.setattr(store._conn, "execute", fail_after_write)
        with pytest.raises(sqlite3.OperationalError):
            if statement.endswith("source"):
                await index.register_resource_source(replace(source, priority=2), expected_revision=1)
            else:
                resource.content = b"new material"
                await index.collect_resource(source.source_id)
        row = (await store.get_all_entries())[0]
        assert row["revision"] == 1 and row["content"] == "Resource reference material"
        assert (await store.get_resource_source(source.source_id))[1] == 1
        assert list(await store.get_embeddings(model="fixture", transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION)) == [reference]
        with sqlite3.connect(store._path) as observer:
            assert observer.execute("SELECT COUNT(*) FROM knowledge_revision").fetchone() == (1,)
            assert observer.execute("SELECT COUNT(*) FROM knowledge_resource_revision").fetchone() == (1,)
    finally:
        await store.close()


@pytest.mark.parametrize("raw,media,expected", [
    ("  unicode 中文  ", "text/plain", "unicode 中文"),
    ('{"b":2,"a":"中文"}', "application/json", '{"a":"中文","b":2}'),
])
async def test_resource_parser_preserves_original_hash_and_actual_versions(tmp_path, raw, media, expected):
    store, resource, index, source = await _resource_index(tmp_path)
    try:
        resource.content, resource.media = raw.encode(), media
        await index.collect_resource(source.source_id)
        row = (await store.get_all_entries())[0]
        assert row["content"] == expected
        assert row["resource"].snapshot.revision == hashlib.sha256(raw.encode()).hexdigest()
        assert row["resource"].chunk_version == "whole-resource.v1"
    finally:
        await store.close()


@pytest.mark.parametrize("raw,media", [(b"", "text/plain"), (b"\xff", "text/plain"), (b"x" * 32769, "text/plain"),
    (b'{"x":1,"x":2}', "application/json"), (b"NaN", "application/json"), (b"1e999", "application/json"), (b"broken", "application/json"), (b"x", "image/png")],
    ids=["empty", "invalid-utf8", "oversized", "duplicate-json", "nan", "overflow", "broken-json", "unsupported-media"])
async def test_invalid_resource_material_never_creates_source_revision(tmp_path, raw, media):
    store, resource, index, source = await _resource_index(tmp_path)
    try:
        resource.content, resource.media = raw, media
        with pytest.raises((ValueError, UnicodeError)):
            await index.collect_resource(source.source_id)
        assert await store.get_all_entries() == []
        assert (await store.get_resource_source(source.source_id))[2] == 0
    finally:
        await store.close()


@pytest.mark.parametrize("revoke_at", ["none", "model", "tool", "reply"])
async def test_real_native_loop_revalidates_used_knowledge_before_each_step_and_reply(tmp_path, monkeypatch, revoke_at):
    from glimmer_cradle.cognition.attention import AttentionController
    from glimmer_cradle.cognition.inference import (
        InferenceRequest,
        ModelEvent,
        ModelEventKind,
        ModelTier,
    )
    from glimmer_cradle.cognition.loop import LoopController
    from glimmer_cradle.cognition.ports import (
        CapabilityDescriptor,
        CapabilityExposure,
        CapabilityResult,
    )
    from tests.conftest import CLOCK, IDS, build_experience_recorder

    store, resource, index, source = await _resource_index(tmp_path)
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    requests, invocations = [], []

    class _Model:
        async def events(self, request):
            requests.append(request)
            assert "Resource reference material" in request.system
            if not request.history:
                yield ModelEvent(0, ModelEventKind.TOOL_CALL, {"call_id": "call", "name": "weather", "arguments": {}})
                if revoke_at == "model": resource.current = False
            else:
                yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "Resource reference material"})
                if revoke_at == "reply": resource.current = False
            yield ModelEvent(1, ModelEventKind.COMPLETED, {})
        async def cancel(self, session_id): pass

    class _Capabilities:
        async def expose(self, *, scope, run_id, step, remaining_calls):
            return CapabilityExposure(run_id, step, (CapabilityDescriptor(name="weather", description="weather",
                input_schema={}, definition_id="weather", definition_revision="definition:1"),))
        async def invoke(self, invocation):
            invocations.append(invocation)
            if revoke_at == "tool": resource.current = False
            return CapabilityResult(invocation.call_id, invocation.name, "succeeded", {"weather": "sunny"})

    try:
        await index.collect_resource(source.source_id)
        references = []
        prompt = await ReplyContextBuilder(knowledge_base=index, observability=OBSERVABILITY).build(
            persona_prompt="fixed persona", scene_id="scene", conversation_id="conversation", thread_id="main",
            actor_id=None, recall_scope="conversation_private", user_text="read", emotion_state={}, trace_id="trace",
            source_provider_id="provider", resource_references=references)
        assert len(references) == 1
        controller = LoopController(workspace=AttentionController(capacity=3, clock=CLOCK), providers=[],
            experience_recorder=recorder, clock=CLOCK, ids=IDS, observability=OBSERVABILITY,
            knowledge_base=index, native_model=_Model(), capability_factory=lambda _: _Capabilities())
        monkeypatch.setattr(controller._deliberation, "reasoning_tier", lambda: ModelTier.CLOUD_ALLOWED)
        request = InferenceRequest(prompt, "read", knowledge_references=tuple(references))
        with pytest.raises(ValueError, match="requires context revalidation"):
            await controller.run_native(request, model=_Model(), capabilities=_Capabilities(), scope="conversation")
        assert requests == [] and invocations == []
        content = {"source_provider_id": "provider", "scene_id": "scene", "conversation_id": "conversation", "address_mode": "direct"}
        if revoke_at == "none":
            assert await controller._deliberate_native(request, content, ModelTier.CLOUD_ALLOWED) == "Resource reference material"
            assert len(requests) == 2
        else:
            with pytest.raises(RuntimeError, match="context_invalidated"):
                await controller._deliberate_native(request, content, ModelTier.CLOUD_ALLOWED)
            assert len(requests) == (2 if revoke_at == "reply" else 1)
            assert await index.get_knowledge(scope=PRIVATE) == []
        assert len(invocations) == (0 if revoke_at == "model" else 1)
    finally:
        await recorder.stop()
        await store.close()
