"""Knowledge 版本化检索；持久正文是事实，embedding 和进程缓存只是派生物。"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import replace

import numpy as np
from glimmer_cradle.cognition.inference import EmbeddingPort
from glimmer_cradle.cognition.knowledge.ingestion import (
    config_entries_from,
    resource_capture_from,
)
from glimmer_cradle.cognition.knowledge.knowledge_store import (
    KnowledgeConflictError,
    KnowledgeStore,
)
from glimmer_cradle.cognition.knowledge.retrieval import (
    KnowledgeRetrievalPolicy,
    bigram_retrieve,
)
from glimmer_cradle.cognition.knowledge.revision import KnowledgeRevision
from glimmer_cradle.cognition.knowledge.source import (
    KnowledgeEntry,
    KnowledgeResourceCapture,
    KnowledgeResourceSource,
)
from glimmer_cradle.cognition.knowledge.transformation import (
    KNOWLEDGE_TRANSFORMATION_VERSION,
)
from glimmer_cradle.cognition.ports import KnowledgeInitialization, ObservabilityPort
from glimmer_cradle.cognition.ports.resource_port import ResourcePort, ResourceScope


def _reference(entry: KnowledgeEntry) -> KnowledgeRevision:
    return KnowledgeRevision(
        entry.entry_id, entry.revision, entry.source, entry.content_digest
    )


class KnowledgeIndex:
    """Worker 注入唯一 Knowledge store；配置 intake 不拥有人格或平台 IO。"""

    def __init__(self, *, observability: ObservabilityPort) -> None:
        self._logger = observability.logger("knowledge_base")
        self._entries: dict[str, KnowledgeEntry] = {}
        self._policy = KnowledgeRetrievalPolicy()
        self._embedding_engine: EmbeddingPort | None = None
        self._repo: KnowledgeStore | None = None
        self._index_lock = asyncio.Lock()
        self._resource_port: ResourcePort | None = None
        self._principal_id: str | None = None

    def set_embedding_engine(self, engine: EmbeddingPort) -> None:
        self._embedding_engine = engine if engine.is_available() else None

    def bind_repository(self, repo: KnowledgeStore) -> None:
        self._repo = repo

    def bind_resource_port(self, port: ResourcePort, *, principal_id: str) -> None:
        if not isinstance(principal_id, str) or not principal_id.strip():
            raise ValueError("Knowledge principal is required")
        self._resource_port, self._principal_id = port, principal_id

    async def register_resource_source(self, source: KnowledgeResourceSource, *, expected_revision: int = 0) -> int:
        """可信 App 管理入口；模型和工具不拥有此 API，登记不等于授权。"""
        if self._repo is None:
            raise RuntimeError("Knowledge store is not bound")
        async with self._index_lock:
            return await self._repo.register_resource_source(source, expected_revision=expected_revision)

    async def get_resource_source(self, source_id: str) -> tuple[KnowledgeResourceSource, int, int] | None:
        if self._repo is None:
            raise RuntimeError("Knowledge store is not bound")
        async with self._index_lock:
            return await self._repo.get_resource_source(source_id)

    async def collect_resource(self, source_id: str, *, expected_source_revision: int | None = None) -> KnowledgeRevision:
        """显式采集一次，不跨 RPC 持有 SQL 事务，不自动重试/写入 Memory。"""
        if self._repo is None or self._resource_port is None or self._principal_id is None:
            raise RuntimeError("Knowledge resource collection is not bound")
        async with self._index_lock:
            declaration = await self._repo.get_resource_source(source_id)
            if declaration is None:
                raise KeyError(source_id)
            source, source_revision, entry_revision = declaration
            if expected_source_revision is not None and (type(expected_source_revision) is not int
                    or expected_source_revision != source_revision):
                raise KnowledgeConflictError("Knowledge source revision conflict")
            if not source.enabled:
                raise PermissionError("Knowledge source is disabled")
            snapshot = deepcopy(await self._resource_port.read(source.resource_id,
                source_id=source.source_id, definition_revision=source.definition_revision,
                principal_id=self._principal_id, scope=source.scope))
            capture = resource_capture_from(source, snapshot)
            if snapshot.access.principal_id != self._principal_id or not await self._resource_port.is_current(
                snapshot, principal_id=self._principal_id, scope=source.scope
            ):
                raise PermissionError("Knowledge resource evidence is not current")
            reference = await self._repo.upsert_resource_entry(capture,
                expected_source_revision=source_revision, expected_entry_revision=entry_revision)
            try:
                current = await self._resource_port.is_current(snapshot, principal_id=self._principal_id, scope=source.scope)
            except Exception:
                await self._repo.invalidate_resource_entry(reference)
                raise
            if not current:
                await self._repo.invalidate_resource_entry(reference)
                raise PermissionError("Knowledge resource revoked during acceptance")
            return reference

    async def load_persisted(self) -> None:
        async with self._index_lock:
            await self._load_current()

    async def _load_current(self, scope: ResourceScope | None = None) -> None:
        if self._repo is None:
            self._entries = {}
            return
        rows = await self._repo.get_all_entries()
        entries = {}
        for row in rows:
            capture = row.get("resource")
            if row["source"] == "resource":
                if not self._resource_visible(capture, scope):
                    continue
                if capture.content != row["content"] or capture.source.entry_id != row["entry_id"] or capture.source.priority != row["priority"]:
                    raise KnowledgeConflictError("Knowledge Resource 正文与来源冲突")
                if not await self._resource_current(capture):
                    await self._repo.invalidate_resource_entry(KnowledgeRevision(row["entry_id"], row["revision"], row["source"], row["content_digest"]))
                    continue
            entries[row["entry_id"]] = KnowledgeEntry(
                entry_id=row["entry_id"],
                content=row["content"],
                priority=row["priority"],
                enabled=row["enabled"],
                revision=row["revision"],
                source=row["source"],
                attributes={"activation": row["activation"], "resource": capture},
                content_digest=row["content_digest"],
            )
        self._entries = entries
        await self._restore_or_compute_embeddings()

    def _resource_visible(self, capture: KnowledgeResourceCapture | None, scope: ResourceScope | None) -> bool:
        if not isinstance(scope, ResourceScope):
            return False
        values = (scope.source_provider_id, scope.scene_id, scope.conversation_id)
        if not all(value is None for value in values) and any(not isinstance(value, str) or not value.strip() for value in values):
            return False
        return bool(capture is not None and scope is not None and self._resource_port is not None
                    and capture.snapshot.access.principal_id == self._principal_id
                    and (capture.source.scope == ResourceScope() or capture.source.scope == scope))

    async def _resource_current(self, capture: KnowledgeResourceCapture) -> bool:
        try:
            return bool(await self._resource_port.is_current(capture.snapshot,
                principal_id=self._principal_id, scope=capture.source.scope))
        except Exception:
            self._logger.warning("Knowledge 来源复验失败，拒绝使用派生材料")
            return False

    async def init_from_kernel(self, payload: KnowledgeInitialization) -> None:
        """仅由受控配置入口替换 config 来源；模型与工具不能自行登记知识。"""
        retrieval = payload.retrieval
        policy = KnowledgeRetrievalPolicy(
            mode=retrieval.mode,
            top_k=retrieval.top_k,
            min_score=retrieval.min_score,
            semantic_weight=retrieval.semantic_weight,
        )
        if self._repo is None:
            raise RuntimeError("Knowledge 没有持久 owner，拒绝宣称初始化成功")
        async with self._index_lock:
            await self._repo.replace_config_entries(config_entries_from(payload))
            self._policy = policy
            await self._load_current()
        self._logger.info(
            "知识配置注入完成", version=payload.version, entry_count=len(self._entries)
        )

    async def _restore_or_compute_embeddings(self) -> None:
        engine = self._embedding_engine
        if (
            self._policy.mode != "semantic_rag"
            or engine is None
            or not engine.is_available()
        ):
            return
        assert self._repo is not None
        try:
            stored = await self._repo.get_embeddings(
                model=engine.model_id,
                transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
            )
        except KnowledgeConflictError:
            # 派生索引损坏可以降级，不能用修复索引的名义重写来源/修订事实。
            self._logger.warning("Knowledge 派生索引无效，降级为基础检索")
            return
        missing: list[KnowledgeEntry] = []
        for entry in self._entries.values():
            if not entry.enabled:
                continue
            vector = stored.get(_reference(entry))
            if vector is None:
                missing.append(entry)
            else:
                entry._embedding = vector
        if not missing:
            return
        try:
            vectors = np.asarray(
                await engine.encode(
                    [entry.content for entry in missing], text_type="document"
                )
            )
            if (
                vectors.ndim != 2
                or vectors.shape[0] != len(missing)
                or not 1 <= vectors.shape[1] <= 65_536
                or not np.isfinite(vectors).all()
                or np.iscomplexobj(vectors)
            ):
                raise ValueError("Knowledge embedding 批次维度或数值非法")
            for entry, vector in zip(missing, vectors, strict=True):
                # 不跨模型 await 持有 SQL 事务；接纳时重验 revision/hash/来源。
                capture = entry.attributes.get("resource")
                if capture is not None and not await self._resource_current(capture):
                    await self._repo.invalidate_resource_entry(_reference(entry))
                    continue
                await self._repo.upsert_embedding(
                    _reference(entry),
                    model=engine.model_id,
                    transformation_version=KNOWLEDGE_TRANSFORMATION_VERSION,
                    vector=vector,
                )
                entry._embedding = vector.copy()
        except KnowledgeConflictError:
            self._logger.debug("Knowledge 编码期间来源已修订，迟到索引未接纳")
        except Exception:
            self._logger.warning("Knowledge 向量生成失败，降级为基础检索")

    async def get_knowledge(self, query: str = "", *, scope: ResourceScope | None = None) -> list[KnowledgeEntry]:
        async with self._index_lock:
            # 不依赖进程通知；另一连接/重开后的更新、删除必须在当前检索中可观察。
            await self._load_current(scope)
            if self._policy.mode == "full_injection":
                selected = sorted(
                    (entry for entry in self._entries.values() if entry.enabled),
                    key=lambda entry: (-entry.priority, entry.entry_id),
                )
            else:
                selected = await self._retrieve(query)
            return await self._filter_current(selected, scope)

    async def is_context_current(self, references: tuple[KnowledgeRevision, ...], *, scope: ResourceScope | None) -> bool:
        """用于本次 Run 的 Step/回复门；不从缓存或模型文本重构权限。"""
        if not references:
            return True
        if self._repo is None:
            return False
        async with self._index_lock:
            rows = {row["entry_id"]: row for row in await self._repo.get_all_entries() if row["enabled"]}
            for reference in references:
                row = rows.get(reference.entry_id)
                if row is None or (row["revision"], row["source"], row["content_digest"]) != (reference.revision, "resource", reference.content_digest) or reference.source != "resource":
                    return False
                capture = row.get("resource")
                if not self._resource_visible(capture, scope):
                    return False
                if not await self._resource_current(capture):
                    await self._repo.invalidate_resource_entry(reference)
                    return False
            latest = {(row["entry_id"], row["revision"], row["source"], row["content_digest"])
                      for row in await self._repo.get_all_entries() if row["enabled"]}
            return all((ref.entry_id, ref.revision, ref.source, ref.content_digest) in latest for ref in references)

    async def _filter_current(
        self, entries: list[KnowledgeEntry], scope: ResourceScope | None = None
    ) -> list[KnowledgeEntry]:
        if self._repo is None:
            return []
        current = {
            row["entry_id"]: (row["revision"], row["source"], row["content_digest"])
            for row in await self._repo.get_all_entries()
            if row["enabled"]
        }
        # query/document 编码期间也可能失效；旧正文不能凭已有向量继续进入 Context。
        selected = []
        for entry in entries:
            if current.get(entry.entry_id) != (entry.revision, entry.source, entry.content_digest):
                continue
            if entry.source == "resource":
                capture = entry.attributes.get("resource")
                if not self._resource_visible(capture, scope):
                    continue
                if not await self._resource_current(capture):
                    await self._repo.invalidate_resource_entry(_reference(entry))
                    continue
            selected.append(replace(entry, _embedding=None))
        # 所有 live await 之后重查 SQL，避免另一连接在前一条复验期间修订早先候选。
        latest = {row["entry_id"]: (row["revision"], row["source"], row["content_digest"])
                  for row in await self._repo.get_all_entries() if row["enabled"]}
        return [entry for entry in selected if latest.get(entry.entry_id) ==
                (entry.revision, entry.source, entry.content_digest)]

    def get_all_entries(self) -> list[KnowledgeEntry]:
        """只读诊断用的最近加载快照，不是实时检索授权入口。"""
        return [replace(entry, _embedding=None) for entry in self._entries.values() if entry.source != "resource"]

    async def _retrieve(self, query: str) -> list[KnowledgeEntry]:
        entries = [entry for entry in self._entries.values() if entry.enabled]
        if not entries or not query.strip():
            return entries[: self._policy.top_k]
        engine = self._embedding_engine
        if engine is not None and engine.is_available():
            indexed = [entry for entry in entries if entry._embedding is not None]
            # 部分编码失败不能让有效但未索引的正文从检索中消失。
            if indexed and len(indexed) == len(entries):
                try:
                    return await self._semantic_retrieve(query, indexed)
                except Exception:
                    self._logger.warning("Knowledge 语义检索失败，降级为基础检索")
        return bigram_retrieve(query, entries, policy=self._policy)

    async def _semantic_retrieve(
        self, query: str, entries: list[KnowledgeEntry]
    ) -> list[KnowledgeEntry]:
        assert self._embedding_engine is not None
        query_vector = np.asarray(
            await self._embedding_engine.encode_single(query, text_type="query")
        )
        matrix = np.stack([entry._embedding for entry in entries])
        if (
            query_vector.ndim != 1
            or query_vector.size != matrix.shape[1]
            or not np.isfinite(query_vector).all()
            or np.iscomplexobj(query_vector)
        ):
            raise ValueError("Knowledge 查询向量非法")
        scores = self._embedding_engine.cosine_similarities(query_vector, matrix)
        if len(scores) != len(entries) or not np.isfinite(scores).all():
            raise ValueError("Knowledge 检索分数非法")
        ranked = sorted(
            zip(scores, entries, strict=True),
            key=lambda item: float(item[0]),
            reverse=True,
        )
        return [
            entry
            for score, entry in ranked[: self._policy.top_k]
            if float(score) >= self._policy.min_score
        ]
