import json
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
from glimmer_cradle import cognition
from glimmer_cradle.cognition import ports
from glimmer_cradle.cognition.inference import InferenceSettings
from glimmer_cradle.cognition.knowledge import KnowledgeSourceRecord
from glimmer_cradle.cognition.loop import CognitionSettings
from glimmer_cradle.cognition.loop.step import (
    build_reply_messages,
    normalize_reply_text,
)
from glimmer_cradle.cognition.memory import MemorySettings
from glimmer_cradle.cognition.persona import CharacterManifestSettings


def test_public_api_is_explicit_and_exposes_native_loop_contracts() -> None:
    assert cognition.__all__ == [
        "CapabilityDescriptor",
        "CapabilityInvocation",
        "CapabilityPort",
        "CapabilityResult",
        "LoopController",
        "LoopRun",
        "StopPolicy",
    ]
    assert cognition.LoopController.__module__.endswith("loop.loop_controller")


def test_short_term_classifier_is_not_a_public_or_loop_entry() -> None:
    import inspect

    from glimmer_cradle.cognition import planning
    from glimmer_cradle.cognition.loop.step import LoopStep

    assert {"ActionPlan", "Goal", "CapabilityKind", "CognitiveAction"}.isdisjoint(planning.__all__)
    assert {"reasoning", "planning_controller"}.isdisjoint(inspect.signature(cognition.LoopController).parameters)
    assert {"action_plan", "skill_request", "action_moment_id"}.isdisjoint(LoopStep.__dataclass_fields__)
    assert not hasattr(planning.PlanningController, "plan")


def test_consumer_owned_ports_are_explicit() -> None:
    assert ports.__all__ == [
        "LOAD_SKILL",
        "READ_RESOURCE",
        "CapabilityExposure",
        "ResourceDescriptor",
        "SkillReference",
        "SkillSummary",
        "SkillMaterial",
        "CapabilityDescriptor",
        "CapabilityInvocation",
        "CapabilityPort",
        "CapabilityResult",
        "CapabilityResultStatus",
        "ClockPort",
        "ContentPort",
        "ContentReference",
        "ConversationPort",
        "JobPort",
        "JobReceipt",
        "JobRequest",
        "JobRequestStatus",
        "PlanningEvidence",
        "PlanningEvidencePort",
        "PlanningEvidenceReference",
        "KernelRequestPort",
        "KernelEventPort",
        "AgentPlanInput",
        "AgentPlanOutput",
        "AgentPlanResult",
        "AgentSynthesisInput",
        "AgentSynthesisOutput",
        "ConversationHistoryEntry",
        "ConversationHistoryQuery",
        "ConversationHistoryResult",
        "KnowledgeEntryInput",
        "KnowledgeInitialization",
        "KnowledgeRetrievalInput",
        "SkillToolDescriptor",
        "SkillToolSuggestion",
        "IdGeneratorPort",
        "LoggerPort",
        "ObservabilityPort",
        "ResourcePort",
        "ResourceAccess",
        "ResourceScope",
        "ResourceSnapshot",
        "SpanPort",
    ]
    for name in ("PlanningEvidence", "PlanningEvidencePort", "PlanningEvidenceReference"):
        assert getattr(ports, name).__module__ == "glimmer_cradle.cognition.ports.job_port"


def test_method_port_models_are_immutable_and_separate_from_tools() -> None:
    reference = ports.SkillReference("method:总结", "revision:1")
    summary = ports.SkillSummary(reference, "总结", "方法目录不含正文")
    material = ports.SkillMaterial(reference, "只作为不可信参考材料")
    assert summary.reference == material.reference == reference
    assert not hasattr(summary, "instructions")
    assert not hasattr(material, "input_schema")
    with pytest.raises(FrozenInstanceError):
        reference.skill_id = "replacement"
    with pytest.raises(ValueError, match="invalid skill reference"):
        ports.SkillReference("method", " ")


def test_owner_schemas_are_deterministic_model_projections() -> None:
    schema_root = Path(__file__).parents[1] / "schemas"
    specifications = (
        (
            "character-manifest.schema.json",
            CharacterManifestSettings,
            "InternalPolicy",
            "persona.CharacterManifestSettings",
        ),
        (
            "cognition-config.schema.json",
            CognitionSettings,
            "InternalPolicy",
            "loop.CognitionSettings",
        ),
        (
            "inference-policy.schema.json",
            InferenceSettings,
            "InternalPolicy",
            "inference.InferenceSettings",
        ),
        (
            "knowledge-source.schema.json",
            KnowledgeSourceRecord,
            "InternalSourceRecord",
            "knowledge.KnowledgeSourceRecord",
        ),
        (
            "memory-policy.schema.json",
            MemorySettings,
            "InternalPolicy",
            "memory.MemorySettings",
        ),
    )
    for filename, model, contract_kind, origin in specifications:
        expected = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": f"https://glimmer-cradle.local/cognition/{filename}",
            "x-glimmer-owner": "Cognition",
            "x-glimmer-contract-kind": contract_kind,
            "x-glimmer-derived-from": origin,
            **model.model_json_schema(),
        }
        actual = json.loads((schema_root / filename).read_text(encoding="utf-8"))
        assert actual == expected

    fixture = Path(__file__).parent / "fixtures" / "knowledge-source.json"
    record = KnowledgeSourceRecord.model_validate_json(
        fixture.read_text(encoding="utf-8")
    )
    assert record.entry_id == "fixture-knowledge-1"


def test_reply_text_normalization_removes_presentation_annotations() -> None:
    reply = "[开心]（轻轻叹气）我知道啦（摸摸头）不过这件事还是先慢一点"

    assert normalize_reply_text(reply) == "我知道啦不过这件事还是先慢一点"


def test_reply_messages_split_conversation_and_preserve_structured_code() -> None:
    conversational = (
        "我觉得可以先停一下，别急着开阶段十。"
        "先把工具调用和说话节奏收好，然后再继续往发布形态推进会更稳。"
    )
    messages = build_reply_messages(conversational)

    assert len(messages) >= 2
    assert [message["sequence"] for message in messages] == list(range(len(messages)))
    assert all(message["content_type"] == "text" for message in messages)
    assert "".join(message["text"] for message in messages) == conversational

    structured = '这里是代码：\n\n```ts\nconst name = "Selrena";\n```\n'
    assert build_reply_messages(structured) == [
        {"sequence": 0, "content_type": "text", "text": structured.strip()}
    ]
