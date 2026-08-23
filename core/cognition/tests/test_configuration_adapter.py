from __future__ import annotations

import pytest

from glimmer_cradle.cognition.adapters.configuration import map_character_runtime_document
from glimmer_cradle.cognition.domain.exceptions import ConfigException
from tests.config_fixture import normalized_document


def test_normalized_document_maps_to_typed_internal_settings() -> None:
    settings = map_character_runtime_document(normalized_document())
    assert settings.cognition.workspace_capacity == 7
    assert settings.memory.retrieval.semantic_weight == 0.35


@pytest.mark.parametrize("mutation", ["missing", "null", "unknown", "range", "wrong_type"])
def test_document_mapping_fails_closed_with_stable_type(mutation: str) -> None:
    document = normalized_document()
    if mutation == "missing":
        del document["cognition"]
    elif mutation == "null":
        document["memory"]["retrieval"] = None
    elif mutation == "unknown":
        document["cognition"]["surprise"] = True
    elif mutation == "range":
        document["memory"]["retrieval"]["semantic_weight"] = 2.5
    else:
        document["cognition"]["workspace_capacity"] = "7"

    with pytest.raises(ConfigException, match="Cognition 配置 Document 映射失败"):
        map_character_runtime_document(document)


def test_workspace_capacity_zero_is_rejected() -> None:
    document = normalized_document()
    document["cognition"]["workspace_capacity"] = 0
    with pytest.raises(ConfigException):
        map_character_runtime_document(document)


def test_noncanonical_embedding_provider_key_is_rejected() -> None:
    document = normalized_document()
    provider = document["embedding"]["providers"].pop("dashscope-text-embedding")
    document["embedding"]["providers"]["dashscope_text_embedding"] = provider
    with pytest.raises(ConfigException):
        map_character_runtime_document(document)
