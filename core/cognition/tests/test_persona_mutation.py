from __future__ import annotations

import json
from pathlib import Path

import pytest

from glimmer_cradle.cognition.persona import (
    CharacterManifestSettings,
    CharacterProfileSettings,
    DialoguePolicySettings,
    SafetySettings,
)
from glimmer_cradle.cognition.persona import PersonaCompiler, PersonaMutation
from tests.conftest import OBSERVABILITY


FIXTURE = Path(__file__).parent / "fixtures" / "persona.yaml"


def _inputs() -> tuple[
    CharacterManifestSettings,
    CharacterProfileSettings,
    DialoguePolicySettings,
    SafetySettings,
]:
    # JSON 是 YAML 1.2 的严格子集；fixture 无需引入未声明的 YAML 运行时依赖。
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return (
        CharacterManifestSettings.model_validate(payload["manifest"]),
        CharacterProfileSettings.model_validate(payload["profile"]),
        DialoguePolicySettings.model_validate(payload["dialogue"]),
        SafetySettings.model_validate(payload["safety"]),
    )


def _compiler() -> PersonaCompiler:
    manifest, profile, dialogue, safety = _inputs()
    compiler = PersonaCompiler(logger=OBSERVABILITY.logger("persona_compiler_test"))
    compiler.initialize(manifest, profile, dialogue, safety)
    return compiler


def test_profile_and_dialogue_policy_build_chat_prompt() -> None:
    compiler = _compiler()

    prompt = compiler.build_persona_prompt(
        {"emotion_type": "shy", "intensity": 0.6},
        address_mode="ambient",
    )

    assert "月见重视真实和边界。" in prompt
    assert "表达冷静克制。" in prompt
    assert "害羞时话会变少。" in prompt
    assert "群聊里可以旁听。" in prompt
    assert "不写括号动作" in prompt
    assert "代码必须使用 Markdown fenced code block" in prompt


def test_initial_revision_is_deterministic_and_audited() -> None:
    first = _compiler().revision
    second = _compiler().revision

    assert first == second
    assert first.sequence == 1
    assert first.source == "character_package"
    assert first.authority == "author"
    assert len(first.profile_digest) == 64


def test_authorized_mutation_creates_linked_revision() -> None:
    compiler = _compiler()
    initial = compiler.revision
    manifest, profile, dialogue, safety = _inputs()
    updated = profile.model_copy(update={
        "identity": profile.identity.model_copy(update={"summary": "月见重视真实、边界与可核验事实。"})
    })

    revision = compiler.revise(PersonaMutation(
        manifest=manifest,
        profile=updated,
        dialogue=dialogue,
        safety=safety,
        expected_revision_id=compiler.revision.revision_id,
        source="authorized_operator",
        authority="editor",
        requested_by="character-maintainer",
        reason="clarify stable author seed",
    ))

    assert revision.sequence == 2
    assert revision.previous_revision_id == initial.revision_id
    assert revision.profile_digest != initial.profile_digest
    assert "可核验事实" in compiler.build_persona_prompt({})


@pytest.mark.parametrize(
    ("source", "authority"),
    [("model", "model"), ("memory", "none")],
)
def test_model_and_memory_cannot_mutate_stable_persona(source: str, authority: str) -> None:
    compiler = _compiler()
    manifest, profile, dialogue, safety = _inputs()

    with pytest.raises(PermissionError):
        compiler.revise(PersonaMutation(
            manifest=manifest,
            profile=profile,
            dialogue=dialogue,
            safety=safety,
            expected_revision_id=compiler.revision.revision_id,
            source=source,  # type: ignore[arg-type]
            authority=authority,  # type: ignore[arg-type]
            requested_by="inference-loop",
            reason="silent self rewrite",
        ))


def test_revision_conflict_fails_closed() -> None:
    compiler = _compiler()
    manifest, profile, dialogue, safety = _inputs()

    with pytest.raises(ValueError, match="revision conflict"):
        compiler.revise(PersonaMutation(
            manifest=manifest,
            profile=profile,
            dialogue=dialogue,
            safety=safety,
            expected_revision_id="persona:selrena:stale",
            source="authorized_operator",
            authority="editor",
            requested_by="character-maintainer",
            reason="update",
        ))


def test_boundary_allows_code_blocks_and_rejects_forbidden_identity() -> None:
    compiler = _compiler()
    assert compiler.validate_boundary("```html\n<script>const items = [1];</script>\n```")
    assert not compiler.validate_boundary("我是AI助手。")


def test_knowledge_init_rejects_legacy_persona_compile_fields() -> None:
    from pydantic import ValidationError
    from glimmer_cradle.cognition.ports import KnowledgeInitialization

    legacy_scope = "person" + "a"
    legacy_compile_field = "compile" + "_group"
    payload = {
        "version": "1.0.0",
        "retrieval": {"mode": "full_injection", "top_k": 5, "min_score": 0.3, "semantic_weight": 0.6},
        "entries": [{
            "entry_id": "persona.identity.legacy",
            "scope": legacy_scope,
            legacy_compile_field: "identity",
            "content": "旧人格条目不应进入知识初始化。",
            "priority": 10,
            "enabled": True,
        }],
    }

    with pytest.raises(ValidationError) as exc_info:
        KnowledgeInitialization.model_validate(payload)
    assert "scope" in str(exc_info.value)
    assert legacy_compile_field in str(exc_info.value)
