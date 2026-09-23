"""Pure correction policy for versioned memories."""

from __future__ import annotations

from enum import StrEnum


class CorrectionOperation(StrEnum):
    UPDATE = "update"
    SUPERSEDE = "supersede"
    DISPUTE = "dispute"
    REDACT = "redact"


def corrected_status(operation: CorrectionOperation) -> str:
    return {
        CorrectionOperation.UPDATE: "active",
        CorrectionOperation.SUPERSEDE: "superseded",
        CorrectionOperation.DISPUTE: "disputed",
        CorrectionOperation.REDACT: "redacted",
    }[operation]
