"""Knowledge revision metadata."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class KnowledgeRevision:
    entry_id: str
    revision: int
    source: str
    content_digest: str
