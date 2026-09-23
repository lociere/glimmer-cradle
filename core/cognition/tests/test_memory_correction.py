import pytest

from glimmer_cradle.cognition.memory import (
    CorrectionOperation,
    corrected_status,
    normalize_evidence,
)


def test_correction_operation_maps_to_explicit_revision_status() -> None:
    assert corrected_status(CorrectionOperation.UPDATE) == "active"
    assert corrected_status(CorrectionOperation.SUPERSEDE) == "superseded"
    assert corrected_status(CorrectionOperation.DISPUTE) == "disputed"
    assert corrected_status(CorrectionOperation.REDACT) == "redacted"


def test_memory_evidence_is_deduplicated_and_cannot_be_empty() -> None:
    evidence = normalize_evidence(
        [
            {"moment_id": "m-1", "role": "support"},
            {"moment_id": "m-1", "role": "replacement"},
            {"moment_id": "", "role": "ignored"},
        ]
    )
    assert evidence == [{"moment_id": "m-1", "role": "replacement"}]
    with pytest.raises(ValueError, match="Moment"):
        normalize_evidence([])
