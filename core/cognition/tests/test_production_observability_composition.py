from __future__ import annotations

from glimmer_cradle.cognition.adapters.configuration import map_character_runtime_document
from glimmer_cradle.cognition.adapters.observability import binding
from glimmer_cradle.cognition.host.composition import compose_cognition
from tests.config_fixture import normalized_document
from tests.support import RecordingLogger


def test_production_composition_injects_reachable_logger_sink(monkeypatch, tmp_path) -> None:
    records: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        binding, "get_logger", lambda name: RecordingLogger(records, name)
    )
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv("GLIMMER_CRADLE_OBSERVABILITY_DIR", str(tmp_path / "observability"))

    async def shutdown() -> None:
        return None

    components = compose_cognition(
        map_character_runtime_document(normalized_document()),
        generation="test-generation",
        registration_nonce="test-nonce",
        registration_secret=bytearray(b"test-secret"),
        shutdown=shutdown,
    )
    components.cycle_controller.logger.info("production-sink-probe", marker="reachable")

    assert any(
        event.endswith(":production-sink-probe") and values.get("marker") == "reachable"
        for _, event, values in records
    )
