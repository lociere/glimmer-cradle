from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

from glimmer_cradle.cognition.domain.configuration import CharacterProfileSettings


@dataclass(frozen=True)
class CompiledPersonaProfile:
    identity_segment: str
    expression_segment: str
    example_block: str
    emotion_behaviors: Dict[str, str] = field(default_factory=dict)
    context_behaviors: Dict[str, str] = field(default_factory=dict)


class PersonaProfileCompiler:
    """Compile CharacterProfileSettings into deterministic prompt segments."""

    def compile(self, profile_config: CharacterProfileSettings) -> CompiledPersonaProfile:
        identity_parts = [profile_config.identity.summary]
        if profile_config.identity.appearance:
            identity_parts.append(profile_config.identity.appearance)
        identity_parts.extend(self._enabled_contents(profile_config.identity.values or []))
        identity_parts.extend(self._enabled_contents(profile_config.traits))
        identity_parts.extend(self._enabled_contents(profile_config.relationship))

        expression_parts = self._enabled_contents(profile_config.expression)
        example_parts = self._enabled_contents(profile_config.examples or [])

        return CompiledPersonaProfile(
            identity_segment="".join(identity_parts),
            expression_segment="".join(expression_parts),
            example_block="\n".join(example_parts),
            emotion_behaviors=self._compile_conditional(profile_config.emotion_behaviors or []),
            context_behaviors=self._compile_conditional(profile_config.context_behaviors or []),
        )

    @staticmethod
    def _enabled_contents(entries) -> list[str]:
        enabled = [entry for entry in entries if getattr(entry, "enabled", True) is not False]
        ordered = sorted(
            enabled,
            key=lambda entry: getattr(entry, "priority", 1) or 1,
            reverse=True,
        )
        return [entry.content for entry in ordered]

    @classmethod
    def _compile_conditional(cls, entries) -> Dict[str, str]:
        grouped: Dict[str, list] = {}
        for entry in entries:
            if getattr(entry, "enabled", True) is False:
                continue
            grouped.setdefault(entry.condition, []).append(entry)
        return {
            condition: "".join(cls._enabled_contents(items))
            for condition, items in grouped.items()
        }
