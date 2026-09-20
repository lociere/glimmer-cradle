"""Content 资产跨重启读取、视觉能力降级与历史读取。"""

import hashlib
import json
from pathlib import Path

import pytest

from glimmer_cradle.cognition.adapters.content.asset_reader import AssetReader
from glimmer_cradle.cognition.adapters.inference.multimodal import MultimodalRouter
from glimmer_cradle.cognition.domain.configuration import (
    ActionStreamSettings, InferenceSettings, LifeClockSettings, ModelSettings, MultimodalSettings,
)


def _asset(root: Path, asset_id: str, media_type: str, data: bytes) -> dict:
    ref = {"asset_id": asset_id, "media_type": media_type,
           "size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    folder = root / asset_id
    folder.mkdir(parents=True)
    (folder / "blob").write_bytes(data)
    (folder / "metadata.json").write_text(json.dumps({
        "assetId": asset_id, "mediaType": media_type,
        "sizeBytes": len(data), "sha256": ref["sha256"],
    }), encoding="utf-8")
    return ref


def _router(reader: AssetReader) -> MultimodalRouter:
    return MultimodalRouter(InferenceSettings(
        model=ModelSettings(max_tokens=1024, temperature=0.8, top_p=0.9, frequency_penalty=0),
        life_clock=LifeClockSettings(heartbeat_enabled=False, heartbeat_interval_ms=45000,
            focus_duration_ms=20000, ingress_debounce_ms=1400, ingress_focused_debounce_ms=700,
            ingress_max_batch_messages=4, ingress_max_batch_items=24, summon_keywords=[], focus_on_any_chat=False),
        multimodal=MultimodalSettings(enabled=True, strategy="core_direct", max_items=6,
            core_model="vision", image_model="", video_model=""),
        action_stream=ActionStreamSettings(enabled=False, channel="live2d"),
    ), reader)


def test_restarted_reader_verifies_bytes_and_routes_image_audio_video(tmp_path: Path) -> None:
    state = tmp_path / "state"
    image = _asset(state, "00000000-0000-4000-8000-000000000001", "image/png", b"png")
    audio = _asset(state, "00000000-0000-4000-8000-000000000002", "audio/wav", b"wav")
    video = _asset(state, "00000000-0000-4000-8000-000000000003", "video/mp4", b"mp4")
    document = _asset(state, "00000000-0000-4000-8000-000000000004", "application/pdf", b"pdf")
    reader = AssetReader(state, tmp_path / "work")
    route = _router(reader).route({"text": "看和听", "parts": [
        {"content": {"image": image}},
        {"content": {"audio": audio}, "semantic": {"text": "你好", "resolved": True}},
        {"content": {"video": video}},
        {"content": {"file": {"asset": document, "name": "a.pdf"}}},
    ]})
    assert len(route.vision_messages) == 1
    assert route.vision_messages[0].uri == "data:image/png;base64,cG5n"
    assert "[语音1] 你好" in route.semantic_text
    assert "视频" in route.semantic_text and "视觉能力当前不可用" in route.semantic_text
    assert "文件理解能力" in route.semantic_text
    assert not any(message.mime_type.startswith(("audio/", "video/")) for message in route.vision_messages)

    (state / image["asset_id"] / "blob").write_bytes(b"bad")
    with pytest.raises(ValueError, match="损坏"):
        AssetReader(state, tmp_path / "work").verify(image)
    degraded = _router(AssetReader(state, tmp_path / "work")).route({"parts": [{"content": {"image": image}}]})
    assert degraded.vision_messages == []
    assert "视觉能力当前不可用" in degraded.semantic_text


def test_legacy_video_audio_and_expired_uri_degrade_without_forged_asset(tmp_path: Path) -> None:
    route = _router(AssetReader(tmp_path / "missing", tmp_path / "work")).route({"items": [
        {"modality": "video", "uri": "https://expired.example/voice", "mime_type": "audio/wav"},
        {"modality": "video", "uri": "https://expired.example/video", "mime_type": "video/mp4"},
    ]})
    assert len(route.audio_items) == 1
    assert len(route.video_items) == 1
    assert route.vision_messages == []
    assert "当前没有可用的转写文本" in route.semantic_text
