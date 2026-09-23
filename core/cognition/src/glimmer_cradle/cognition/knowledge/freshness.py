"""Knowledge freshness classification."""

from enum import StrEnum


class Freshness(StrEnum):
    CURRENT = "current"
    STALE = "stale"
    INVALIDATED = "invalidated"
