import io
import json

import numpy as np
import pytest

from glimmer_cradle.cognition.inference import embedding as embedding_module
from glimmer_cradle.cognition.inference.embedding import EmbeddingEngine
from glimmer_cradle.cognition.protocol.generated.config.embedding_config import EmbeddingConfig


def _config(*, enabled: bool = True, provider: str = "dashscope-text-embedding") -> EmbeddingConfig:
    return EmbeddingConfig.model_validate({
        "enabled": enabled,
        "route": {"provider": provider},
        "providers": {
            "dashscope-text-embedding": {
                "endpoint": "https://example.invalid/embeddings",
                "model": "text-embedding-v4",
                "dimensions": 64,
                "request_timeout_ms": 1000,
                "max_retries": 0,
            },
            "local-sentence-transformers": {
                "model_path": "embedding/test-model",
                "model_id": "test/model",
                "auto_download": False,
                "device": "cpu",
                "batch_size": 8,
            },
        },
    })


async def test_disabled_embedding_is_normal_baseline(monkeypatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    engine = EmbeddingEngine(_config(enabled=False))

    assert engine.is_available() is False
    assert engine.model_id == ""
    with pytest.raises(RuntimeError, match="未配置"):
        await engine.encode_single("不会发起请求")


async def test_enabled_cloud_provider_requires_secret(monkeypatch) -> None:
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    engine = EmbeddingEngine(_config())

    assert engine.is_available() is False


async def test_dashscope_uses_document_and_query_semantics(monkeypatch) -> None:
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-only-key")
    payloads: list[dict] = []

    class _Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    def fake_urlopen(req, timeout):
        assert timeout == 1.0
        payload = json.loads(req.data.decode("utf-8"))
        payloads.append(payload)
        embeddings = [
            {"text_index": index, "embedding": [float(index + 1)] * 64}
            for index, _ in enumerate(payload["input"]["texts"])
        ]
        return _Response(json.dumps({"output": {"embeddings": embeddings}}).encode("utf-8"))

    monkeypatch.setattr(embedding_module.request, "urlopen", fake_urlopen)
    engine = EmbeddingEngine(_config())

    documents = await engine.encode(["第一条", "第二条"], text_type="document")
    query = await engine.encode_single("查询", text_type="query")

    assert engine.is_available() is True
    assert engine.model_id == "dashscope-text-embedding:text-embedding-v4:64"
    assert documents.shape == (2, 64)
    assert query.shape == (64,)
    assert np.all(documents[1] == 2.0)
    assert [payload["parameters"]["text_type"] for payload in payloads] == [
        "document",
        "query",
    ]
