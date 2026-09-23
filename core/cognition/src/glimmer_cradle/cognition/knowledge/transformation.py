"""Deterministic Knowledge transformations."""

import hashlib


def content_digest(content: str) -> str:
    return hashlib.sha256(content.strip().encode("utf-8")).hexdigest()
