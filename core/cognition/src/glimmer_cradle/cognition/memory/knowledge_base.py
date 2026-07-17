"""
知识库模块 — 世界知识管理器

职责：管理 scope=knowledge 的事实知识条目（天气、时间、食物等）。
角色人格、对话呈现策略和安全边界由 Character Package 配置承载，不经过此模块。

检索策略（由 retrieval.mode 决定）：
- full_injection：全量注入所有已启用条目（条目 <50 时推荐）
- semantic_rag ：向量语义检索 Top-K（条目 ≥50 时切换）
  · 有向量引擎 → cosine similarity 排序
  · 无向量引擎 → bigram 关键词退化
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

from glimmer_cradle.cognition.protocol.generated.ipc.knowledge_init_payload import KnowledgeBaseInitPayload
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.inference.embedding import EmbeddingEngine
from glimmer_cradle.cognition.memory.storage.knowledge_repo import KnowledgeRepository
from glimmer_cradle.cognition.memory.storage.vector_repo import VectorRepository

logger = get_logger("knowledge_base")

# 英文单词 / 汉字逐字分词（bigram 在 _tokenize 中生成）
_TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]")


@dataclass
class KnowledgeRetrievalPolicy:
    mode: str = "full_injection"  # "full_injection" | "semantic_rag"
    top_k: int = 5
    min_score: float = 0.3
    semantic_weight: float = 0.6


@dataclass
class KnowledgeEntry:
    entry_id: str
    content: str
    priority: int = 1
    enabled: bool = True
    _embedding: Optional[np.ndarray] = field(default=None, repr=False, compare=False)


class KnowledgeBase:
    """由 SelfEntity 独占的世界知识管理器。

    初始化流程：
      1. Kernel 内核发送 knowledge_init IPC
      2. adapter 将 KnowledgeInitPayload 交给此处
      3. init_from_kernel() 注册 scope=knowledge 条目，按 mode 决定检索策略
    """

    def __init__(self) -> None:
        self._entries: Dict[str, KnowledgeEntry] = {}
        self._policy = KnowledgeRetrievalPolicy()
        self._embedding_engine: Optional[EmbeddingEngine] = None
        # Repository 由 Composition Root 注入，领域对象不创建存储。
        self._repo: Optional[KnowledgeRepository] = None
        # 向量持久化避免每次进程启动重新计算。
        self._vec_repo: Optional[VectorRepository] = None
        logger.info("世界知识库初始化完成")

    def set_embedding_engine(self, engine: EmbeddingEngine) -> None:
        """接入由 Composition Root 创建的嵌入引擎。"""
        self._embedding_engine = engine if engine.is_available() else None
        if self._embedding_engine:
            logger.info("知识库已接入向量引擎，semantic_rag 模式可用")

    def bind_repository(self, repo: KnowledgeRepository) -> None:
        """绑定知识持久化仓库。"""
        self._repo = repo

    def bind_vector_repository(self, vec_repo: VectorRepository) -> None:
        """绑定可重建向量索引仓库。"""
        self._vec_repo = vec_repo

    async def load_persisted(self) -> None:
        """从 Cognition 记忆事实库加载知识条目。"""
        if self._repo is None:
            return
        rows = await self._repo.get_all_entries()
        self._entries = {
            r["entry_id"]: KnowledgeEntry(
                entry_id=r["entry_id"],
                content=r["content"],
                priority=r["priority"],
                enabled=r["enabled"],
            )
            for r in rows
        }
        await self._restore_or_compute_embeddings()
        logger.info("知识库已从本地库加载", entry_count=len(self._entries))

    async def init_from_kernel(self, payload: KnowledgeBaseInitPayload) -> None:
        """从内核 knowledge_init 载荷预填知识库。

        knowledge_init 是知识库的配置预填入口，只接收
        scope=knowledge 条目，以 source='config' 持久化到 memory.db，再从库
        重新加载。检索策略（policy）是运行时配置，不持久化。
        """
        retrieval = payload.retrieval
        self._policy = KnowledgeRetrievalPolicy(
            mode=retrieval.mode,
            top_k=retrieval.top_k,
            min_score=retrieval.min_score,
            semantic_weight=retrieval.semantic_weight,
        )

        config_entries = [
            {
                "entry_id": r.entry_id,
                "content": r.content,
                "priority": r.priority,
                "enabled": r.enabled,
            }
            for r in payload.entries
            if r.scope == "knowledge" and r.enabled
        ]

        if self._repo is None:
            logger.error("知识库未绑定持久化仓库，knowledge_init 已跳过")
            return

        await self._repo.replace_config_entries(config_entries)
        await self.load_persisted()
        logger.info(
            "知识库注入完成",
            version=payload.version,
            mode=self._policy.mode,
            entry_count=len(self._entries),
        )

    async def _restore_or_compute_embeddings(self) -> None:
        """semantic_rag 模式下恢复向量，缺失或模型变化时重算并回存。"""
        if self._policy.mode != "semantic_rag":
            return
        if not (self._embedding_engine and self._embedding_engine.is_available()):
            return
        model_id = self._embedding_engine.model_id
        stored: dict = {}
        if self._vec_repo is not None:
            stored = await self._vec_repo.get_vectors("knowledge", model_id)

        missing: list[KnowledgeEntry] = []
        for entry in self._entries.values():
            vec = stored.get(entry.entry_id)
            if vec is not None:
                entry._embedding = vec
            else:
                missing.append(entry)

        if missing:
            try:
                vectors = await self._embedding_engine.encode(
                    [e.content for e in missing], text_type="document"
                )
                for entry, vec in zip(missing, vectors):
                    entry._embedding = vec
                if self._vec_repo is not None:
                    for entry in missing:
                        await self._vec_repo.upsert_vector(
                            owner_kind="knowledge", owner_id=entry.entry_id,
                            model=model_id, vector=entry._embedding,
                        )
            except Exception as exc:
                logger.warning("知识库语义索引更新失败，继续使用基础检索", error=str(exc))
                return
        logger.info(
            "知识库向量就绪",
            restored=len(self._entries) - len(missing),
            recomputed=len(missing),
        )

    # ------------------------------------------------------------------
    # 对外检索接口
    # ------------------------------------------------------------------

    async def get_knowledge(self, query: str = "") -> List[KnowledgeEntry]:
        """统一对外接口。

        full_injection 模式：返回所有已启用条目（按优先级排序）。
        semantic_rag  模式：向量检索 Top-K，无引擎时 bigram 退化。
        """
        if self._policy.mode == "full_injection":
            return sorted(
                [e for e in self._entries.values() if e.enabled],
                key=lambda e: e.priority,
                reverse=True,
            )
        return await self._retrieve(query)

    def get_all_entries(self) -> List[KnowledgeEntry]:
        """获取所有条目（用于调试/导出）。"""
        return list(self._entries.values())

    # ------------------------------------------------------------------
    # 内部检索实现（semantic_rag 模式）
    # ------------------------------------------------------------------

    async def _retrieve(self, query: str) -> List[KnowledgeEntry]:
        """semantic_rag 模式下的检索。"""
        entries = [e for e in self._entries.values() if e.enabled]
        if not entries or not query.strip():
            return entries[:self._policy.top_k]

        # 尝试语义检索
        if self._embedding_engine and self._embedding_engine.is_available():
            has_embedding = [e for e in entries if e._embedding is not None]
            if has_embedding:
                try:
                    return await self._semantic_retrieve(query, has_embedding)
                except Exception as exc:
                    logger.warning("语义检索异常，继续使用基础检索", error=str(exc))

        # 退化为 bigram
        return self._bigram_retrieve(query, entries)

    async def _semantic_retrieve(
        self, query: str, entries: List[KnowledgeEntry]
    ) -> List[KnowledgeEntry]:
        """向量余弦相似度检索。"""
        assert self._embedding_engine is not None
        query_vec = await self._embedding_engine.encode_single(query, text_type="query")
        matrix = np.stack([e._embedding for e in entries])
        sims = self._embedding_engine.cosine_similarities(query_vec, matrix)
        scored = sorted(zip(sims, entries), key=lambda x: float(x[0]), reverse=True)
        return [e for sim, e in scored[:self._policy.top_k] if float(sim) >= self._policy.min_score]

    def _bigram_retrieve(self, query: str, entries: List[KnowledgeEntry]) -> List[KnowledgeEntry]:
        """bigram 关键词退化检索。"""
        query_tokens = self._tokenize(query)
        if not query_tokens:
            return entries[:self._policy.top_k]

        scored = []
        for entry in entries:
            content_tokens = self._tokenize(entry.content)
            overlap = len(query_tokens & content_tokens)
            if overlap > 0:
                score = overlap / len(query_tokens)
                scored.append((score, entry))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [e for score, e in scored[:self._policy.top_k] if score >= self._policy.min_score]

    @staticmethod
    def _tokenize(text: str) -> set:
        """Bigram 分词：逐字 + 相邻汉字双字组合。"""
        chars = _TOKEN_RE.findall(text or "")
        tokens: set = {c.lower() for c in chars}
        for i in range(len(chars) - 1):
            if len(chars[i]) == 1 and len(chars[i + 1]) == 1:
                tokens.add(chars[i] + chars[i + 1])
        return tokens
