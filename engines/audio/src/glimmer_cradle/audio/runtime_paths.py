from __future__ import annotations

import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[5]


def resolve_data_root() -> Path:
    configured = os.environ.get("GLIMMER_CRADLE_DATA_ROOT")
    if configured and configured.strip():
        return Path(configured).expanduser().resolve()
    return (REPO_ROOT / "data").resolve()


def resolve_models_root() -> Path:
    configured = os.environ.get("GLIMMER_CRADLE_MODELS_DIR")
    if configured and configured.strip():
        return Path(configured).expanduser().resolve()
    return (resolve_data_root() / "models").resolve()


def resolve_packages_root() -> Path:
    configured = os.environ.get("GLIMMER_CRADLE_PACKAGES_DIR")
    if configured and configured.strip():
        return Path(configured).expanduser().resolve()
    return (resolve_data_root() / "packages").resolve()


def resolve_observability_root() -> Path:
    return (resolve_data_root() / "observability").resolve()


def resolve_logs_root() -> Path:
    return (resolve_observability_root() / "logs").resolve()


def resolve_repo_relative(path_value: str) -> Path:
    candidate = Path(path_value).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    normalized = path_value.replace("\\", "/")
    if normalized == "data":
        return resolve_data_root()
    if normalized.startswith("data/"):
        return (resolve_data_root() / normalized[len("data/") :]).resolve()
    return (REPO_ROOT / path_value).resolve()


def resolve_models_path(relative_path: str) -> Path:
    return _resolve_within_root(resolve_models_root(), relative_path, "data/models")


def resolve_packages_path(relative_path: str) -> Path:
    return _resolve_within_root(resolve_packages_root(), relative_path, "data/packages")


def resolve_logs_path(relative_path: str) -> Path:
    return _resolve_within_root(
        resolve_logs_root(), relative_path, "data/observability/logs"
    )


def _resolve_within_root(root: Path, relative_path: str, label: str) -> Path:
    candidate = (root / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"路径越过 {label} 边界: {relative_path}")
    return candidate
