import pytest

from glimmer_cradle.audio.resource_catalog import (
    load_resource_catalog,
    resolve_resource,
)


def test_local_audio_resource_catalog_only_declares_asr() -> None:
    catalog = load_resource_catalog()

    asr = resolve_resource("asr")

    assert "tts" not in catalog["defaults"]
    assert asr["id"] == catalog["defaults"]["asr"]
    assert asr["modelRepository"]

    with pytest.raises(ValueError, match="未声明 tts 默认 resource"):
        resolve_resource("tts")
