from pathlib import Path

import glimmer_cradle.cognition_worker as worker
from glimmer_cradle.cognition_worker.composition import WorkerPaths


def test_worker_public_api_is_explicit(worker_config: dict[str, int]) -> None:
    assert worker.__all__ == [
        "CognitionComponents",
        "CognitionHost",
        "ReadinessTracker",
        "ShutdownCoordinator",
        "compose_cognition",
        "main",
    ]
    assert worker_config["readiness_timeout_ms"] >= 1000


def test_worker_paths_honor_process_roots(monkeypatch, tmp_path: Path) -> None:
    app_root = tmp_path / "app"
    data_root = tmp_path / "deployment-data"
    monkeypatch.setenv("GLIMMER_CRADLE_APP_ROOT", str(app_root))
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(data_root))

    paths = WorkerPaths.from_environment()

    assert paths.repo_root == app_root
    assert paths.data_root == data_root
    assert paths.cognition_state_dir / "state.sqlite" == (
        data_root / "state" / "cognition" / "state.sqlite"
    )


def test_worker_paths_resolve_relative_data_root_from_app_root(
    monkeypatch, tmp_path: Path
) -> None:
    app_root = tmp_path / "app"
    monkeypatch.setenv("GLIMMER_CRADLE_APP_ROOT", str(app_root))
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", "runtime-data")

    assert WorkerPaths.from_environment().data_root == app_root / "runtime-data"
