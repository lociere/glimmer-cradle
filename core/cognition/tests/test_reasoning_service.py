"""InferenceController 只路由显式注入的真实后端。"""
import pytest

from glimmer_cradle.cognition.inference import (
    ModelTier,
    InferenceRequest,
    InferenceResponse,
    InferenceController as _InferenceController,
    InferenceUnavailable,
)
from tests.conftest import OBSERVABILITY


def InferenceController(*args, **kwargs):
    kwargs.setdefault("observability", OBSERVABILITY)
    return _InferenceController(*args, **kwargs)


def _req(user: str = "你好") -> InferenceRequest:
    return InferenceRequest(system="你是月见。", user=user)


# ── 测试用 Mock 后端 ────────────────────────────────────────────────────

class _MockCloud:
    """可控的云后端 mock —— 标记可用性 + 计数调用。"""

    def __init__(self, *, available: bool = True, response_text: str = "cloud-ok") -> None:
        self.available = available
        self.response_text = response_text
        self.call_count = 0

    async def generate(self, req: InferenceRequest) -> InferenceResponse:
        self.call_count += 1
        if not self.available:
            raise RuntimeError("simulated cloud outage")
        return InferenceResponse(
            text=self.response_text,
            tier_used=ModelTier.CLOUD_ALLOWED,
            duration_ms=10.0,
        )


class _MockLocal:
    def __init__(self, *, available: bool = True, response_text: str = "local-ok") -> None:
        self.available = available
        self.response_text = response_text
        self.call_count = 0

    async def generate(self, req: InferenceRequest) -> InferenceResponse:
        self.call_count += 1
        if not self.available:
            raise RuntimeError("simulated local outage")
        return InferenceResponse(
            text=self.response_text,
            tier_used=ModelTier.LOCAL_ONLY,
            duration_ms=5.0,
        )


# ── tier=NONE ────────────────────────────────────────────────────────────

async def test_tier_none_raises_unavailable() -> None:
    rs = InferenceController(cloud=_MockCloud(), local=_MockLocal())
    with pytest.raises(InferenceUnavailable):
        await rs.request(_req(), tier=ModelTier.NONE)


# ── tier=LOCAL_ONLY ──────────────────────────────────────────────────────

async def test_tier_local_only_uses_local_not_cloud() -> None:
    cloud = _MockCloud()
    local = _MockLocal()
    rs = InferenceController(cloud=cloud, local=local)
    resp = await rs.request(_req(), tier=ModelTier.LOCAL_ONLY)
    assert cloud.call_count == 0  # 没碰云
    assert resp.tier_used == ModelTier.LOCAL_ONLY
    assert resp.text == "local-ok"
    assert local.call_count == 1


async def test_tier_local_only_no_local_backend_raises() -> None:
    rs = InferenceController(cloud=_MockCloud(), local=None)
    with pytest.raises(InferenceUnavailable):
        await rs.request(_req(), tier=ModelTier.LOCAL_ONLY)


async def test_tier_local_only_local_fails_raises() -> None:
    rs = InferenceController(cloud=_MockCloud(), local=_MockLocal(available=False))
    with pytest.raises(InferenceUnavailable):
        await rs.request(_req(), tier=ModelTier.LOCAL_ONLY)


# ── tier=CLOUD_ALLOWED ───────────────────────────────────────────────────

async def test_tier_cloud_allowed_prefers_cloud() -> None:
    cloud = _MockCloud(response_text="cloud-priority")
    rs = InferenceController(cloud=cloud, local=_MockLocal())
    resp = await rs.request(_req(), tier=ModelTier.CLOUD_ALLOWED)
    assert cloud.call_count == 1
    assert resp.text == "cloud-priority"
    assert resp.tier_used == ModelTier.CLOUD_ALLOWED


async def test_tier_cloud_allowed_falls_back_to_local_on_cloud_failure() -> None:
    cloud = _MockCloud(available=False)
    rs = InferenceController(cloud=cloud, local=_MockLocal())
    resp = await rs.request(_req(), tier=ModelTier.CLOUD_ALLOWED)
    assert cloud.call_count == 1  # 试过云
    assert resp.tier_used == ModelTier.LOCAL_ONLY  # 降级后返回 local
    assert resp.text == "local-ok"


async def test_tier_cloud_allowed_no_cloud_uses_local() -> None:
    rs = InferenceController(cloud=None, local=_MockLocal())
    resp = await rs.request(_req(), tier=ModelTier.CLOUD_ALLOWED)
    assert resp.tier_used == ModelTier.LOCAL_ONLY


async def test_tier_cloud_allowed_both_unavailable_raises() -> None:
    rs = InferenceController(cloud=_MockCloud(available=False),
                          local=_MockLocal(available=False))
    with pytest.raises(InferenceUnavailable):
        await rs.request(_req(), tier=ModelTier.CLOUD_ALLOWED)


# ── 请求结构 ────────────────────────────────────────────────────────────

def test_request_default_params() -> None:
    r = _req()
    assert r.max_tokens == 512
    assert r.temperature == 0.7
    assert r.system and r.user


# ── ModelTier 枚举值 ────────────────────────────────────────────────────

def test_model_tier_enum_values() -> None:
    assert ModelTier.NONE.value == "none"
    assert ModelTier.LOCAL_ONLY.value == "local_only"
    assert ModelTier.CLOUD_ALLOWED.value == "cloud_allowed"
