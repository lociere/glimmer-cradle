"""
Persona facade.

Character identity comes from character.manifest.yaml, safety comes from
safety.yaml, stable author seed comes from profile.yaml, and visible reply
presentation comes from dialogue.yaml.
KnowledgeBase does not feed persona facts.
"""

from __future__ import annotations

import re

from glimmer_cradle.cognition.domain.configuration import (
    CharacterManifestSettings,
    CharacterProfileSettings,
    DialoguePolicySettings,
    SafetySettings,
)
from glimmer_cradle.cognition.ports.observability import LoggerPort
from glimmer_cradle.cognition.domain.persona.dialogue_policy_builder import DialoguePolicyBuilder
from glimmer_cradle.cognition.domain.persona.profile_compiler import (
    CompiledPersonaProfile,
    PersonaProfileCompiler,
)
from glimmer_cradle.cognition.domain.persona.prompt_assembler import PromptAssembler

class PersonaInjector:
    """Stable facade name for persona prompt assembly.

    The class no longer compiles KnowledgeBase entries. It owns deterministic
    assembly of profile, dialogue policy, current affect and safety boundary.
    """

    def __init__(self, *, logger: LoggerPort) -> None:
        self._logger = logger
        self.manifest_config: CharacterManifestSettings | None = None
        self.profile_config: CharacterProfileSettings | None = None
        self.dialogue_config: DialoguePolicySettings | None = None
        self.safety_config: SafetySettings | None = None
        self._profile_compiler = PersonaProfileCompiler()
        self._dialogue_builder = DialoguePolicyBuilder()
        self._prompt_assembler = PromptAssembler()
        self._compiled_profile: CompiledPersonaProfile | None = None
        self._dialogue_policy_segment: str = ""

    def init(
        self,
        manifest_config: CharacterManifestSettings,
        profile_config: CharacterProfileSettings,
        dialogue_config: DialoguePolicySettings,
        safety_config: SafetySettings,
    ) -> None:
        self.manifest_config = manifest_config
        self.profile_config = profile_config
        self.dialogue_config = dialogue_config
        self.safety_config = safety_config
        self._compiled_profile = self._profile_compiler.compile(profile_config)
        self._dialogue_policy_segment = self._dialogue_builder.build(dialogue_config)
        self._logger.info(
            "人格提示词门面初始化完成",
            persona_mode=manifest_config.persona_mode,
        )

    def build_persona_prompt(self, emotion_state: dict, address_mode: str = "direct") -> str:
        if self.manifest_config is None or self.safety_config is None or self._compiled_profile is None:
            raise ValueError("人设注入器未初始化，请先调用 init 方法")

        return self._prompt_assembler.build_persona_prompt(
            manifest_config=self.manifest_config,
            safety_config=self.safety_config,
            compiled_profile=self._compiled_profile,
            dialogue_policy_segment=self._dialogue_policy_segment,
            emotion_state=emotion_state,
            address_mode=address_mode,
        )

    def validate_boundary(self, content: str) -> bool:
        if self.safety_config is None:
            raise ValueError("人设注入器未初始化，请先调用 init 方法")

        lowered = content.lower()

        for phrase in self.safety_config.forbidden_phrases:
            if phrase.lower() in lowered:
                return False

        for pattern in self.safety_config.forbidden_regex:
            if re.search(pattern, content, re.IGNORECASE):
                return False

        return True

    def get_persona_name(self) -> str:
        if self.manifest_config is None:
            return "当前角色"
        return self.manifest_config.base.nickname
