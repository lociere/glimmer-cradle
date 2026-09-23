import pytest

from glimmer_cradle.cognition.knowledge import require_authorized_source


def test_model_and_memory_cannot_mutate_curated_knowledge() -> None:
    require_authorized_source("config")
    require_authorized_source("editor")
    with pytest.raises(PermissionError):
        require_authorized_source("model")
    with pytest.raises(PermissionError):
        require_authorized_source("memory")
