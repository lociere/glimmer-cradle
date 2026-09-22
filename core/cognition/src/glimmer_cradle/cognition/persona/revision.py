"""Persona revision 与稳定摘要。"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json

from glimmer_cradle.cognition.persona.profile import PersonaProfile


@dataclass(frozen=True)
class PersonaRevision:
    """Persona 更新的审计头；正文由 ``profile_digest`` 完整绑定。"""

    revision_id: str
    sequence: int
    profile_digest: str
    source: str
    authority: str
    requested_by: str
    reason: str
    previous_revision_id: str | None = None

    @classmethod
    def initial(cls, profile: PersonaProfile) -> "PersonaRevision":
        digest = profile_digest(profile)
        return cls(
            revision_id=f"persona:{profile.character_id}:1:{digest[:16]}",
            sequence=1,
            profile_digest=digest,
            source="character_package",
            authority="author",
            requested_by="kernel_config",
            reason="load_author_seed",
        )

    def successor(
        self,
        profile: PersonaProfile,
        *,
        source: str,
        authority: str,
        requested_by: str,
        reason: str,
    ) -> "PersonaRevision":
        digest = profile_digest(profile)
        sequence = self.sequence + 1
        return PersonaRevision(
            revision_id=f"persona:{profile.character_id}:{sequence}:{digest[:16]}",
            sequence=sequence,
            profile_digest=digest,
            source=source,
            authority=authority,
            requested_by=requested_by,
            reason=reason,
            previous_revision_id=self.revision_id,
        )


def profile_digest(profile: PersonaProfile) -> str:
    canonical = json.dumps(
        profile.fingerprint_payload(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256(canonical).hexdigest()
