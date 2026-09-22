"""Persona 更新授权策略。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from glimmer_cradle.cognition.domain.configuration import (
    CharacterManifestSettings,
    CharacterProfileSettings,
    DialoguePolicySettings,
    SafetySettings,
)
from glimmer_cradle.cognition.persona.revision import PersonaRevision

PersonaMutationSource = Literal["character_package", "authorized_operator", "model", "memory"]
PersonaMutationAuthority = Literal["author", "editor", "model", "none"]


@dataclass(frozen=True)
class PersonaMutation:
    """携带并发前提、来源、权限和原因的一次完整 Persona 替换。"""

    manifest: CharacterManifestSettings
    profile: CharacterProfileSettings
    dialogue: DialoguePolicySettings
    safety: SafetySettings
    expected_revision_id: str
    source: PersonaMutationSource
    authority: PersonaMutationAuthority
    requested_by: str
    reason: str


class PersonaMutationPolicy:
    """只允许作者包或获授权操作员显式改写稳定 Persona。"""

    def authorize(self, current: PersonaRevision, mutation: PersonaMutation) -> None:
        if mutation.expected_revision_id != current.revision_id:
            raise ValueError("persona revision conflict")
        if mutation.source not in {"character_package", "authorized_operator"}:
            raise PermissionError("persona mutation source is not authoritative")
        if mutation.authority not in {"author", "editor"}:
            raise PermissionError("persona mutation authority is insufficient")
        if not mutation.requested_by.strip():
            raise ValueError("persona mutation requested_by is required")
        if not mutation.reason.strip():
            raise ValueError("persona mutation reason is required")
