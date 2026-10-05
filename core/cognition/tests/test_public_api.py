import json
from pathlib import Path

import glimmer_cradle.cognition as cognition
from glimmer_cradle.cognition import ports
from glimmer_cradle.cognition.inference import InferenceSettings
from glimmer_cradle.cognition.knowledge import KnowledgeSourceRecord
from glimmer_cradle.cognition.loop import CognitionSettings
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


def test_consumer_owned_ports_are_explicit() -> None:
    assert ports.__all__ == [
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
        "ResourceSnapshot",
        "SpanPort",
    ]


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
