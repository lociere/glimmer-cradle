"""可选语义向量增强。

基础召回不依赖本模块。只有用户显式启用并选定 provider 后，Cognition 才会
为知识和记忆增加语义相似度；provider 不可用不会改变基础召回的就绪语义。
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import threading
import time
from pathlib import Path
from typing import Literal, Protocol, TYPE_CHECKING
from urllib import error, request

import numpy as np

from glimmer_cradle.cognition.foundation.path_utils import resolve_cache_dir, resolve_models_dir
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.protocol.generated.config.embedding_config import (
    DashScopeEmbeddingProviderConfig,
    EmbeddingConfig,
    LocalEmbeddingProviderConfig,
)

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

EmbeddingTextType = Literal["query", "document"]
logger = get_logger("embedding_engine")


class EmbeddingProvider(Protocol):
    provider_id: str
    model_id: str

    def is_configured(self) -> bool: ...

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType
    ) -> np.ndarray: ...


class EmbeddingEngine:
    """把选定 provider 投影为 Cognition 使用的稳定向量 Port。"""

    def __init__(self, config: EmbeddingConfig | None = None) -> None:
        self._provider: EmbeddingProvider | None = None
        if config is None or not config.enabled:
            logger.info("语义向量增强未启用，基础召回保持就绪")
            return

        provider_id = str(config.route.provider)
        if provider_id == "dashscope-text-embedding":
            self._provider = _DashScopeEmbeddingProvider(
                config.providers.dashscope_text_embedding,
                api_key=os.environ.get("DASHSCOPE_API_KEY", "").strip(),
            )
        elif provider_id == "local-sentence-transformers":
            self._provider = _LocalSentenceTransformersProvider(
                config.providers.local_sentence_transformers
            )
        else:
            raise ValueError(f"未知 Embedding provider: {provider_id}")

        if self._provider.is_configured():
            logger.info(
                "语义向量增强已配置",
                provider_id=self._provider.provider_id,
                model_id=self._provider.model_id,
            )
        else:
            logger.warning(
                "语义向量增强已启用但 provider 配置不完整",
                provider_id=self._provider.provider_id,
            )

    def is_available(self) -> bool:
        return self._provider is not None and self._provider.is_configured()

    @property
    def model_id(self) -> str:
        return self._provider.model_id if self._provider is not None else ""

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType = "document"
    ) -> np.ndarray:
        if not self.is_available() or self._provider is None:
            raise RuntimeError("语义向量增强未配置")
        if not texts:
            return np.empty((0, 0), dtype=np.float32)
        return await self._provider.encode(texts, text_type=text_type)

    async def encode_single(
        self, text: str, *, text_type: EmbeddingTextType = "query"
    ) -> np.ndarray:
        return (await self.encode([text], text_type=text_type))[0]

    @staticmethod
    def cosine_similarities(query_vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return np.zeros(matrix.shape[0])
        row_norms = np.linalg.norm(matrix, axis=1)
        row_norms = np.where(row_norms == 0, 1.0, row_norms)
        return (matrix @ query_vec) / (row_norms * query_norm)


class _DashScopeEmbeddingProvider:
    provider_id = "dashscope-text-embedding"
    _MAX_BATCH_SIZE = 10

    def __init__(
        self, config: DashScopeEmbeddingProviderConfig, *, api_key: str
    ) -> None:
        self._config = config
        self._api_key = api_key
        self.model_id = (
            f"{self.provider_id}:{config.model}:{int(config.dimensions)}"
        )

    def is_configured(self) -> bool:
        return bool(self._api_key and self._config.model and self._config.endpoint)

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType
    ) -> np.ndarray:
        batches = [
            texts[index:index + self._MAX_BATCH_SIZE]
            for index in range(0, len(texts), self._MAX_BATCH_SIZE)
        ]
        results: list[np.ndarray] = []
        for batch in batches:
            vectors = await asyncio.to_thread(self._request_batch, batch, text_type)
            results.extend(vectors)
        return np.asarray(results, dtype=np.float32)

    def _request_batch(
        self, texts: list[str], text_type: EmbeddingTextType
    ) -> list[np.ndarray]:
        payload = {
            "model": self._config.model,
            "input": {"texts": texts},
            "parameters": {
                "text_type": text_type,
                "dimension": int(self._config.dimensions),
                "output_type": "dense",
            },
        }
        req = request.Request(
            str(self._config.endpoint),
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        attempts = int(self._config.max_retries) + 1
        for attempt in range(attempts):
            try:
                with request.urlopen(
                    req, timeout=int(self._config.request_timeout_ms) / 1000
                ) as response:
                    body = json.load(response)
                return self._parse_response(body, expected=len(texts))
            except (error.HTTPError, error.URLError, TimeoutError, ValueError) as exc:
                if attempt + 1 >= attempts:
                    raise RuntimeError(
                        f"DashScope Embedding 请求失败: {type(exc).__name__}"
                    ) from exc
                time.sleep(0.25 * (attempt + 1))
        raise RuntimeError("DashScope Embedding 请求失败")

    def _parse_response(self, body: object, *, expected: int) -> list[np.ndarray]:
        if not isinstance(body, dict):
            raise ValueError("Embedding 响应不是对象")
        output = body.get("output")
        embeddings = output.get("embeddings") if isinstance(output, dict) else None
        if not isinstance(embeddings, list) or len(embeddings) != expected:
            raise ValueError("Embedding 响应数量不匹配")
        ordered = sorted(
            embeddings,
            key=lambda item: int(item.get("text_index", 0)) if isinstance(item, dict) else 0,
        )
        vectors: list[np.ndarray] = []
        for item in ordered:
            vector = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(vector, list) or len(vector) != int(self._config.dimensions):
                raise ValueError("Embedding 响应维度不匹配")
            vectors.append(np.asarray(vector, dtype=np.float32))
        return vectors


class _LocalSentenceTransformersProvider:
    provider_id = "local-sentence-transformers"

    def __init__(self, config: LocalEmbeddingProviderConfig) -> None:
        self._config = config
        self._model: SentenceTransformer | None = None
        self._load_lock = threading.Lock()
        self._model_path = self._resolve_model_path(config.model_path)
        identity = str(self._model_path) if self._model_path.exists() else config.model_id
        self.model_id = f"{self.provider_id}:{identity}"

    def is_configured(self) -> bool:
        package_available = importlib.util.find_spec("sentence_transformers") is not None
        source_available = self._model_path.exists() or bool(
            self._config.auto_download and self._config.model_id
        )
        return package_available and source_available

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType
    ) -> np.ndarray:
        del text_type
        return await asyncio.to_thread(self._encode_sync, texts)

    def _encode_sync(self, texts: list[str]) -> np.ndarray:
        model = self._ensure_model()
        vectors = model.encode(
            texts,
            batch_size=int(self._config.batch_size),
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return np.asarray(vectors, dtype=np.float32)

    def _ensure_model(self) -> SentenceTransformer:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            from sentence_transformers import SentenceTransformer

            if self._model_path.exists():
                source = str(self._model_path)
            elif self._config.auto_download and self._config.model_id:
                source = self._config.model_id
            else:
                raise RuntimeError("本地 Embedding 模型未配置")
            model = SentenceTransformer(
                source,
                device=self._config.device,
                cache_folder=str(resolve_cache_dir() / "models" / "sentence-transformers"),
            )
            if not self._model_path.exists() and self._config.auto_download:
                self._model_path.parent.mkdir(parents=True, exist_ok=True)
                model.save(str(self._model_path))
            self._model = model
            return model

    @staticmethod
    def _resolve_model_path(model_path: str) -> Path:
        raw = Path(model_path)
        return raw if raw.is_absolute() else resolve_models_dir() / raw
