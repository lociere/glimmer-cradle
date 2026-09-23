"""Pure retrieval policy for curated knowledge."""

from __future__ import annotations

import re
from dataclasses import dataclass

from glimmer_cradle.cognition.knowledge.source import KnowledgeEntry

_TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]")


@dataclass(frozen=True, slots=True)
class KnowledgeRetrievalPolicy:
    mode: str = "full_injection"
    top_k: int = 5
    min_score: float = 0.3
    semantic_weight: float = 0.6


def tokenize(text: str) -> set[str]:
    chars = _TOKEN_RE.findall(text or "")
    tokens = {item.lower() for item in chars}
    tokens.update(
        chars[index] + chars[index + 1]
        for index in range(len(chars) - 1)
        if len(chars[index]) == len(chars[index + 1]) == 1
    )
    return tokens


def bigram_retrieve(
    query: str,
    entries: list[KnowledgeEntry],
    *,
    policy: KnowledgeRetrievalPolicy,
) -> list[KnowledgeEntry]:
    query_tokens = tokenize(query)
    if not query_tokens:
        return entries[: policy.top_k]
    scored = []
    for entry in entries:
        overlap = len(query_tokens & tokenize(entry.content))
        if overlap:
            scored.append((overlap / len(query_tokens), entry))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [
        entry
        for score, entry in scored[: policy.top_k]
        if score >= policy.min_score
    ]
