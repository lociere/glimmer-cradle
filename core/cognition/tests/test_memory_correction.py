from pathlib import Path

import numpy as np
import pytest

from glimmer_cradle.cognition.adapters.persistence import (
    SqliteMemoryStore,
    VectorRepository,
)
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


async def _open_memory_store(tmp_path: Path) -> SqliteMemoryStore:
    store = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await store.connect()
    return store


async def test_memory_vectors_round_trip_and_filter_by_model(tmp_path: Path) -> None:
    store = await _open_memory_store(tmp_path)
    repository = VectorRepository(store)
    await repository.upsert_vector(
        owner_kind="memory", owner_id="m1", model="model-a",
        vector=np.array([1.0, 2.0, 3.0]),
    )
    await repository.upsert_vector(
        owner_kind="memory", owner_id="m2", model="model-b",
        vector=np.array([4.0, 5.0, 6.0]),
    )

    vectors = await repository.get_vectors("memory", "model-a")
    assert set(vectors) == {"m1"}
    assert np.allclose(vectors["m1"], [1.0, 2.0, 3.0])
    assert await repository.count("memory") == 2
    await store.close()


async def test_memory_vector_upsert_overwrites_and_delete_removes(
    tmp_path: Path,
) -> None:
    store = await _open_memory_store(tmp_path)
    repository = VectorRepository(store)
    await repository.upsert_vector(
        owner_kind="knowledge", owner_id="k1", model="model",
        vector=np.array([1.0]),
    )
    await repository.upsert_vector(
        owner_kind="knowledge", owner_id="k1", model="model",
        vector=np.array([9.0]),
    )
    vectors = await repository.get_vectors("knowledge", "model")
    assert np.allclose(vectors["k1"], [9.0])

    await repository.delete_vector("knowledge", "k1")
    assert await repository.count("knowledge") == 0
    await store.close()
