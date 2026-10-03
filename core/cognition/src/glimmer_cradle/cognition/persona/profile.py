"""Persona 的稳定编译结果与运行时快照。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict


class _PersonaSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class CharacterBaseSettings(_PersonaSettings):
    name: str
    nickname: str


class CharacterAssetsSettings(_PersonaSettings):
    root: str


class CharacterKnowledgeSettings(_PersonaSettings):
    index: str


class CharacterMigrationsSettings(_PersonaSettings):
    root: str


class CharacterManifestSettings(_PersonaSettings):
    character_id: str
    base: CharacterBaseSettings
    persona_mode: Literal["api", "local_base", "local_finetune"]
    assets: CharacterAssetsSettings
    knowledge: CharacterKnowledgeSettings
    migrations: CharacterMigrationsSettings


class ProfileTextEntrySettings(_PersonaSettings):
    id: str
    content: str
    priority: int
    enabled: bool


class ProfileConditionalEntrySettings(ProfileTextEntrySettings):
    condition: str


class ProfileIdentitySettings(_PersonaSettings):
    summary: str
    appearance: str
    values: list[ProfileTextEntrySettings]


class CharacterProfileSettings(_PersonaSettings):
    identity: ProfileIdentitySettings
    traits: list[ProfileTextEntrySettings]
    relationship: list[ProfileTextEntrySettings]
    expression: list[ProfileTextEntrySettings]
    emotion_behaviors: list[ProfileConditionalEntrySettings]
    context_behaviors: list[ProfileConditionalEntrySettings]
    examples: list[ProfileTextEntrySettings]


class DialoguePresentationSettings(_PersonaSettings):
    forbid_stage_directions: bool
    forbid_emotion_labels: bool
    casual_max_sentences: int
    casual_max_chars_per_message: int
    complex_reply_policy: str
    message_split_policy: str
    rules: list[str]


class StructuredOutputSettings(_PersonaSettings):
    preserve_markdown: bool
    preserve_code_blocks: bool
    require_fenced_code_blocks: bool
    rules: list[str]


class DialogueNormalizationSettings(_PersonaSettings):
    strip_stage_directions: bool
    strip_emotion_labels: bool


class DialoguePolicySettings(_PersonaSettings):
    presentation: DialoguePresentationSettings
    structured_output: StructuredOutputSettings
    normalization: DialogueNormalizationSettings


class SafetySettings(_PersonaSettings):
    taboos: str
    forbidden_phrases: list[str]
    forbidden_regex: list[str]


@dataclass(frozen=True)
class CompiledPersonaProfile:
    """从作者种子确定性编译出的提示词片段。"""

    identity_segment: str
    expression_segment: str
    example_block: str
    emotion_behaviors: Mapping[str, str] = field(default_factory=dict)
    context_behaviors: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PersonaProfile:
    """一次可审计 Persona revision 指向的不可变运行时资料。"""

    character_id: str
    canonical_name: str
    nickname: str
    persona_mode: str
    compiled: CompiledPersonaProfile
    dialogue_policy_segment: str
    safety: SafetySettings

    def fingerprint_payload(self) -> dict[str, Any]:
        """返回只含稳定事实的摘要输入，不包含运行时情绪或上下文。"""

        return {
            "character_id": self.character_id,
            "canonical_name": self.canonical_name,
            "nickname": self.nickname,
            "persona_mode": self.persona_mode,
            "compiled": {
                "identity_segment": self.compiled.identity_segment,
                "expression_segment": self.compiled.expression_segment,
                "example_block": self.compiled.example_block,
                "emotion_behaviors": dict(self.compiled.emotion_behaviors),
                "context_behaviors": dict(self.compiled.context_behaviors),
            },
            "dialogue_policy_segment": self.dialogue_policy_segment,
            "safety": self.safety.model_dump(mode="json"),
        }


def compile_profile(
    manifest: CharacterManifestSettings,
    profile: CharacterProfileSettings,
    dialogue: DialoguePolicySettings,
    safety: SafetySettings,
) -> PersonaProfile:
    """把经 Kernel 校验的 Character Package 投影为 Persona 快照。"""

    identity_parts = [profile.identity.summary]
    if profile.identity.appearance:
        identity_parts.append(profile.identity.appearance)
    identity_parts.extend(_enabled_contents(profile.identity.values))
    identity_parts.extend(_enabled_contents(profile.traits))
    identity_parts.extend(_enabled_contents(profile.relationship))

    compiled = CompiledPersonaProfile(
        identity_segment="".join(identity_parts),
        expression_segment="".join(_enabled_contents(profile.expression)),
        example_block="\n".join(_enabled_contents(profile.examples)),
        emotion_behaviors=_compile_conditional(profile.emotion_behaviors),
        context_behaviors=_compile_conditional(profile.context_behaviors),
    )
    return PersonaProfile(
        character_id=manifest.character_id,
        canonical_name=manifest.base.name,
        nickname=manifest.base.nickname,
        persona_mode=manifest.persona_mode,
        compiled=compiled,
        dialogue_policy_segment=_compile_dialogue_policy(dialogue),
        safety=safety,
    )


def _enabled_contents(entries: list[Any]) -> list[str]:
    enabled = [entry for entry in entries if entry.enabled]
    ordered = sorted(enabled, key=lambda entry: entry.priority, reverse=True)
    return [entry.content for entry in ordered]


def _compile_conditional(entries: list[Any]) -> dict[str, str]:
    grouped: dict[str, list[Any]] = {}
    for entry in entries:
        if entry.enabled:
            grouped.setdefault(entry.condition, []).append(entry)
    return {
        condition: "".join(_enabled_contents(items))
        for condition, items in grouped.items()
    }


def _compile_dialogue_policy(dialogue: DialoguePolicySettings) -> str:
    presentation = dialogue.presentation
    structured = dialogue.structured_output
    lines = [
        "[回复呈现]",
        f"- 普通闲聊最多 {presentation.casual_max_sentences} 个短句，单条消息倾向不超过 "
        f"{presentation.casual_max_chars_per_message} 个字。",
        f"- {presentation.message_split_policy}",
        f"- {presentation.complex_reply_policy}",
    ]
    lines.extend(f"- {_rule_text(rule)}" for rule in presentation.rules)
    if presentation.forbid_emotion_labels:
        lines.append("- 不在正文开头写情绪标签。")
    if presentation.forbid_stage_directions:
        lines.append("- 不写括号动作、旁白动作或表演说明。")

    lines.append("\n[结构化输出]")
    lines.extend(f"- {_rule_text(rule)}" for rule in structured.rules)
    if structured.preserve_markdown:
        lines.append("- 用户需要 Markdown 时，保留标题、列表、表格、引用等结构。")
    if structured.preserve_code_blocks:
        lines.append("- 用户需要代码或配置时，保留换行、缩进和必要上下文。")
    if structured.require_fenced_code_blocks:
        lines.append("- 代码必须使用 Markdown fenced code block。")
    return "\n".join(lines)


def _rule_text(rule: Any) -> str:
    return str(getattr(rule, "root", rule))
