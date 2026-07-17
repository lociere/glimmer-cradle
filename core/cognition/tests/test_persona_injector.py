from __future__ import annotations

from glimmer_cradle.cognition.foundation.config import (
    CharacterManifestConfig,
    CharacterProfileConfig,
    DialoguePolicyConfig,
    SafetyConfig,
)
from glimmer_cradle.cognition.persona.persona_injector import PersonaInjector


def _manifest_config() -> CharacterManifestConfig:
    return CharacterManifestConfig.model_validate({
        "character_id": "selrena",
        "base": {"name": "Selrena", "nickname": "月见"},
        "persona_mode": "api",
        "assets": {"root": "assets"},
        "knowledge": {"index": "knowledge/index.yaml"},
        "migrations": {"root": "migrations"},
    })


def _safety_config() -> SafetyConfig:
    return SafetyConfig.model_validate({
        "taboos": "不要自称 AI。",
        "forbidden_phrases": ["我是AI"],
        "forbidden_regex": [r"(AI|人工智能|语言模型).{0,10}(助手|程序)"],
    })


def _profile_config() -> CharacterProfileConfig:
    return CharacterProfileConfig.model_validate({
        "identity": {
            "summary": "月见重视真实和边界。",
            "appearance": "银白长发少女。",
            "values": [
                {"id": "truth", "content": "不为了迎合而伪装。", "priority": 9},
            ],
        },
        "traits": [
            {"id": "calm", "content": "表达冷静克制。", "priority": 9},
        ],
        "relationship": [
            {"id": "presence", "content": "用陪伴式在场回应对方。", "priority": 8},
        ],
        "expression": [
            {"id": "short", "content": "普通聊天优先短句。", "priority": 9},
        ],
        "emotion_behaviors": [
            {"id": "shy", "condition": "shy", "content": "害羞时话会变少。", "priority": 8},
        ],
        "context_behaviors": [
            {"id": "ambient", "condition": "ambient", "content": "群聊里可以旁听。", "priority": 8},
        ],
        "examples": [
            {"id": "line", "content": "「随便。你决定就好。」", "priority": 5},
        ],
    })


def _dialogue_config() -> DialoguePolicyConfig:
    return DialoguePolicyConfig.model_validate({
        "presentation": {
            "forbid_stage_directions": True,
            "forbid_emotion_labels": True,
            "casual_max_sentences": 3,
            "casual_max_chars_per_message": 48,
            "complex_reply_policy": "复杂问题先给短结论，再分段说明。",
            "message_split_policy": "闲聊优先 1 到 3 个短句。",
            "rules": [
                "不写括号动作。",
                "不要把多个意思塞进一个长句。",
            ],
        },
        "structured_output": {
            "preserve_markdown": True,
            "preserve_code_blocks": True,
            "require_fenced_code_blocks": True,
            "rules": [
                "代码和配置保留可复制格式。",
            ],
        },
        "normalization": {
            "strip_stage_directions": True,
            "strip_emotion_labels": True,
        },
    })


def _init_injector() -> PersonaInjector:
    injector = PersonaInjector()
    injector.init(
        manifest_config=_manifest_config(),
        profile_config=_profile_config(),
        dialogue_config=_dialogue_config(),
        safety_config=_safety_config(),
    )
    return injector


def test_profile_and_dialogue_policy_build_chat_prompt() -> None:
    injector = _init_injector()

    prompt = injector.build_persona_prompt(
        {"emotion_type": "shy", "intensity": 0.6},
        address_mode="ambient",
    )

    assert "月见重视真实和边界。" in prompt
    assert "表达冷静克制。" in prompt
    assert "害羞时话会变少。" in prompt
    assert "群聊里可以旁听。" in prompt
    assert "不写括号动作" in prompt
    assert "代码必须使用 Markdown fenced code block" in prompt


def test_boundary_allows_code_blocks_with_square_brackets() -> None:
    injector = _init_injector()

    reply = """这里是一个最小页面：

```html
<script>
const posts = [{ title: "第一篇", content: "这是内容" }];
posts.forEach((post) => console.log(post.title));
</script>
```
"""

    assert injector.validate_boundary(reply)


def test_knowledge_init_rejects_legacy_persona_compile_fields() -> None:
    from pydantic import ValidationError
    from glimmer_cradle.cognition.protocol.generated.ipc.knowledge_init_payload import KnowledgeInitPayload

    legacy_scope = "person" + "a"
    legacy_compile_field = "compile" + "_group"
    payload = {
        "knowledge_base": {
            "version": "1.0.0",
            "retrieval": {
                "mode": "full_injection",
                "top_k": 5,
                "min_score": 0.3,
                "semantic_weight": 0.6,
            },
            "entries": [
                {
                    "entry_id": "persona.identity.legacy",
                    "scope": legacy_scope,
                    legacy_compile_field: "identity",
                    "content": "旧人格条目不应进入知识初始化。",
                    "priority": 10,
                    "enabled": True,
                },
            ],
        },
    }

    try:
        KnowledgeInitPayload.model_validate(payload)
    except ValidationError as exc:
        message = str(exc)
        assert "scope" in message
        assert legacy_compile_field in message
    else:
        raise AssertionError("legacy persona knowledge payload should be rejected")
