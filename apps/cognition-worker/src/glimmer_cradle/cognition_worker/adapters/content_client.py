"""Validated Content asset client."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import re
from typing import Protocol

from glimmer_cradle.cognition.ports import ContentReference

_ASSET_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_MAX_ASSET_BYTES = 256 * 1024 * 1024
_MAX_IMAGE_BYTES = 20 * 1024 * 1024


class ContentTransport(Protocol):
    async def read(self, asset_id: str, *, max_bytes: int) -> bytes: ...


class ContentClient:
    def __init__(self, transport: ContentTransport) -> None:
        self._transport = transport

    async def read(self, reference: ContentReference, *, max_bytes: int) -> bytes:
        if max_bytes < 0 or reference.size_bytes > max_bytes:
            raise ValueError("content exceeds read budget")
        content = await self._transport.read(reference.asset_id, max_bytes=max_bytes)
        if len(content) != reference.size_bytes:
            raise ValueError("content size does not match reference")
        if hashlib.sha256(content).hexdigest() != reference.sha256:
            raise ValueError("content digest does not match reference")
        return content


class FileAssetReader:
    """读取 Content owner 已提交或瞬态保存的本地资产。"""

    def __init__(self, state_root: Path, work_root: Path) -> None:
        self._state_root = state_root
        self._work_root = work_root

    def verify(self, ref: dict) -> Path:
        asset_id = ref.get("asset_id")
        if not isinstance(asset_id, str) or not _ASSET_ID.fullmatch(asset_id):
            raise ValueError("非法资产 ID")
        roots = (self._state_root, self._work_root)
        directory = next(
            (
                root / asset_id
                for root in roots
                if (root / asset_id / "metadata.json").is_file()
            ),
            None,
        )
        if directory is None:
            raise FileNotFoundError("资产不存在")
        stored = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        expected = {
            "assetId": asset_id,
            "mediaType": ref.get("media_type"),
            "sizeBytes": int(ref.get("size_bytes", 0)),
            "sha256": ref.get("sha256"),
        }
        if (
            stored != expected
            or expected["sizeBytes"] <= 0
            or expected["sizeBytes"] > _MAX_ASSET_BYTES
        ):
            raise ValueError("资产元数据与引用不一致")
        blob = directory / "blob"
        digest = hashlib.sha256()
        size = 0
        with blob.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                size += len(chunk)
                digest.update(chunk)
        if size != expected["sizeBytes"] or digest.hexdigest() != expected["sha256"]:
            raise ValueError("资产字节损坏")
        return blob

    def image_data_url(self, ref: dict) -> str:
        media_type = ref.get("media_type", "")
        if not isinstance(media_type, str) or not media_type.startswith("image/"):
            raise ValueError("视觉输入要求图片媒体类型")
        if int(ref.get("size_bytes", 0)) > _MAX_IMAGE_BYTES:
            raise ValueError("图片超过视觉 provider 输入上限")
        blob = self.verify(ref)
        encoded = base64.b64encode(blob.read_bytes()).decode("ascii")
        return f"data:{media_type};base64,{encoded}"
