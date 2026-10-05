from pathlib import Path

import glimmer_cradle.cognition_worker as worker
import io
import json
import numpy as np
import pytest
from glimmer_cradle.cognition_worker.composition import WorkerPaths
from glimmer_cradle.cognition_worker.adapters import model_client as embedding_module
from glimmer_cradle.cognition_worker.adapters.model_client import (
    EmbeddingEngine,
    EmbeddingSettings,
)


def test_worker_public_api_is_explicit(worker_config: dict[str, int]) -> None:
    assert worker.__all__ == [
        "CognitionComponents",
        "CognitionHost",
        "ReadinessTracker",
        "ShutdownCoordinator",
        "compose_cognition",
        "main",
    ]
    assert worker_config["readiness_timeout_ms"] >= 1000


def test_worker_paths_honor_process_roots(monkeypatch, tmp_path: Path) -> None:
    app_root = tmp_path / "app"
    data_root = tmp_path / "deployment-data"
    monkeypatch.setenv("GLIMMER_CRADLE_APP_ROOT", str(app_root))
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(data_root))

    paths = WorkerPaths.from_environment()

    assert paths.repo_root == app_root
    assert paths.data_root == data_root
    assert paths.cognition_state_dir / "state.sqlite" == (
        data_root / "state" / "cognition" / "state.sqlite"
    )


def test_worker_paths_resolve_relative_data_root_from_app_root(
    monkeypatch, tmp_path: Path
) -> None:
    app_root = tmp_path / "app"
    monkeypatch.setenv("GLIMMER_CRADLE_APP_ROOT", str(app_root))
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", "runtime-data")

    assert WorkerPaths.from_environment().data_root == app_root / "runtime-data"


def _embedding_config(
    *, enabled: bool = True, provider: str = "dashscope-text-embedding"
) -> EmbeddingSettings:
    return EmbeddingSettings.model_validate({
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
    engine = EmbeddingEngine(_embedding_config(enabled=False))

    assert engine.is_available() is False
    assert engine.model_id == ""
    with pytest.raises(RuntimeError, match="未配置"):
        await engine.encode_single("不会发起请求")


def test_local_embedding_requires_worker_owned_paths() -> None:
    with pytest.raises(ValueError, match="Worker 注入"):
        EmbeddingEngine(_embedding_config(provider="local-sentence-transformers"))


async def test_dashscope_embedding_preserves_document_and_query_semantics(
    monkeypatch,
) -> None:
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
        return _Response(
            json.dumps({"output": {"embeddings": embeddings}}).encode("utf-8")
        )

    monkeypatch.setattr(embedding_module.request, "urlopen", fake_urlopen)
    engine = EmbeddingEngine(_embedding_config())

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
