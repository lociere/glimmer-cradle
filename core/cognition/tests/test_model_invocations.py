import json
from pathlib import Path

import pytest

import glimmer_cradle.cognition.inference.gateway as llm_module
from glimmer_cradle.cognition.foundation.config import LLMConfig
from glimmer_cradle.cognition.inference.gateway import LLMApiResult, LLMEngine, LLMMessage, LLMRequest
from glimmer_cradle.cognition.protocol.generated.config.inference_config import ModelConfig


class _SelfEntity:
    class _Inference:
        model = ModelConfig()

    inference_config = _Inference()


class _LoggerCapture:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def info(self, event: str, **kwargs) -> None:
        self.messages.append(event + json.dumps(kwargs, ensure_ascii=False, default=str))

    def debug(self, event: str, **kwargs) -> None:
        self.messages.append(event + json.dumps(kwargs, ensure_ascii=False, default=str))

    def warning(self, event: str, **kwargs) -> None:
        self.messages.append(event + json.dumps(kwargs, ensure_ascii=False, default=str))


def _build_engine(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *, capture_mode: str) -> LLMEngine:
    monkeypatch.setenv("GLIMMER_CRADLE_OBSERVABILITY", json.dumps({
        "model_invocations": {
            "capture_mode": capture_mode,
            "redact_secrets": True,
            "full_retention_days": 3,
        }
    }))
    monkeypatch.setenv("GLIMMER_CRADLE_OBSERVABILITY_DIR", str(tmp_path))
    fake_logger = _LoggerCapture()
    monkeypatch.setattr(llm_module, "logger", fake_logger)
    return LLMEngine(
        _SelfEntity(),
        LLMConfig(
            api_type="openai",
            api_key="sk-top-secret",
            base_url="https://example.com",
            models={"chat": "test-model"},
        ),
    )


def test_model_invocation_summary_mode_records_hash_not_prompt(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    engine = _build_engine(monkeypatch, tmp_path, capture_mode="summary")

    monkeypatch.setattr(engine, "_generate_via_api", lambda req, cfg, provider_id: LLMApiResult(
        text="provider reply",
        payload={"messages": [{"role": "user", "content": "secret prompt"}]},
        response_data={"choices": [{"message": {"content": "provider reply"}}]},
        provider_id=provider_id,
        model_id="test-model",
    ))

    reply = engine.generate(LLMRequest(
        messages=[
            LLMMessage(role="system", content="system prompt"),
            LLMMessage(role="user", content="secret prompt"),
        ],
        metadata={
            "purpose": "reply",
            "capture_category": "response",
            "scene_id": "scene-1",
            "trace_id": "trace-1",
        },
    ))
    assert reply == "provider reply"

    records_path = tmp_path / "model-invocations" / "records" / "cognition.jsonl"
    rows = [json.loads(line) for line in records_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(rows) == 1
    row = rows[0]
    assert row["capture_mode"] == "summary"
    assert row["schema_version"] == "2.0.0"
    assert row["purpose"] == "reply"
    assert row["capture_category"] == "response"
    assert row["trace_id"] == "trace-1"
    assert row["prompt_hash"]
    assert row["prompt_text_ref"] is None
    assert row["provider_payload_ref"] is None
    assert "secret prompt" not in json.dumps(row, ensure_ascii=False)
    assert all("secret prompt" not in message for message in llm_module.logger.messages)


def test_model_invocation_full_mode_writes_captures_and_redacts_payload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    engine = _build_engine(monkeypatch, tmp_path, capture_mode="full")

    monkeypatch.setattr(engine, "_generate_via_api", lambda req, cfg, provider_id: LLMApiResult(
        text="full reply",
        payload={
            "headers": {"Authorization": "Bearer sk-top-secret"},
            "messages": [{"role": "user", "content": "full prompt"}],
        },
        response_data={"choices": [{"message": {"content": "full reply"}}]},
        provider_id=provider_id,
        model_id="test-model",
    ))

    engine.generate(LLMRequest(
        messages=[
            LLMMessage(role="system", content="system"),
            LLMMessage(role="user", content="full prompt"),
        ],
        metadata={
            "purpose": "cognitive_action_plan",
            "capture_category": "decision",
            "trace_id": "trace-full",
        },
    ))
    engine.generate(LLMRequest(
        messages=[LLMMessage(role="user", content="plan a skill")],
        metadata={"purpose": "agent_plan", "capture_category": "skill", "trace_id": "trace-full"},
    ))
    engine.generate(LLMRequest(
        messages=[LLMMessage(role="user", content="second prompt")],
        metadata={"purpose": "reply", "capture_category": "response", "trace_id": "trace-full"},
    ))

    rows = [
        json.loads(line)
        for line in (tmp_path / "model-invocations" / "records" / "cognition.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    row = rows[0]
    assert row["prompt_text_ref"]
    assert row["provider_payload_ref"]
    assert row["prompt_text_ref"].endswith("/10-prompt.txt")
    assert "/trace-trace-full/01-action-decision/001_" in row["prompt_text_ref"]
    assert "/trace-trace-full/02-skill-planning/002_" in rows[1]["prompt_text_ref"]
    assert "/trace-trace-full/03-final-response/003_" in rows[2]["prompt_text_ref"]
    invocation_root = tmp_path / "model-invocations"
    prompt_text = (invocation_root / row["prompt_text_ref"]).read_text(encoding="utf-8")
    payload_text = (invocation_root / row["provider_payload_ref"]).read_text(encoding="utf-8")
    assert "full prompt" in prompt_text
    assert "sk-top-secret" not in payload_text
    assert "[REDACTED]" in payload_text or "[REDACTED_API_KEY]" in payload_text

    invocation_dir = (invocation_root / row["prompt_text_ref"]).parent
    manifest = json.loads((invocation_dir / "00-manifest.json").read_text(encoding="utf-8"))
    assert manifest["sequence"] == 1
    assert manifest["schema_version"] == "2.0.0"
    assert manifest["purpose"] == "cognitive_action_plan"
    assert manifest["capture_category"] == "decision"
    assert manifest["files"] == {
        "prompt": "10-prompt.txt",
        "response": "20-response.txt",
        "provider_request": "30-provider-request.json",
        "provider_response": "40-provider-response.json",
    }
    timeline = (invocation_dir.parent.parent / "timeline.md").read_text(encoding="utf-8")
    assert "| 001 |" in timeline
    assert "| 002 |" in timeline
    assert "| 003 |" in timeline
    assert timeline.index("cognitive_action_plan") < timeline.index("agent_plan") < timeline.index("reply")
    assert "01-action-decision" in row["prompt_text_ref"]
    assert "02-skill-planning" in rows[1]["prompt_text_ref"]
    assert "03-final-response" in rows[2]["prompt_text_ref"]


def test_model_invocation_redacts_provider_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    engine = _build_engine(monkeypatch, tmp_path, capture_mode="summary")

    def _raise(req, cfg, provider_id):
        raise llm_module.InferenceException("LLM API 请求失败: 401, Bearer sk-top-secret")

    monkeypatch.setattr(engine, "_generate_via_api", _raise)

    with pytest.raises(llm_module.InferenceException, match="401"):
        engine.generate(LLMRequest(
            messages=[LLMMessage(role="user", content="hello")],
            metadata={"purpose": "reply"},
        ))

    row = json.loads(
        (tmp_path / "model-invocations" / "records" / "cognition.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
    )
    assert row["outcome"] == "failed"
    assert row["capture_category"] == "other"
    assert "sk-top-secret" not in (row["error_summary"] or "")
    assert "Bearer [REDACTED]" in (row["error_summary"] or "")
