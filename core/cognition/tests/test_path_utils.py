from pathlib import Path

from glimmer_cradle.cognition.foundation.path_utils import (
    resolve_global_data_dir,
    resolve_repo_root,
    resolve_run_dir,
)


def test_explicit_app_root_has_packaged_product_precedence(
    monkeypatch, tmp_path: Path
) -> None:
    app_root = tmp_path / "app"
    monkeypatch.setenv("GLIMMER_CRADLE_APP_ROOT", str(app_root))

    assert resolve_repo_root() == app_root


def test_deployment_data_root_owns_all_data_paths(monkeypatch, tmp_path: Path) -> None:
    deployment_root = tmp_path / "deployment-data"
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(deployment_root))

    assert resolve_global_data_dir() == deployment_root


def test_product_owned_run_root_is_independent(monkeypatch, tmp_path: Path) -> None:
    run_root = tmp_path / "coordination"
    monkeypatch.setenv("GLIMMER_CRADLE_RUN_ROOT", str(run_root))

    assert resolve_run_dir() == run_root
