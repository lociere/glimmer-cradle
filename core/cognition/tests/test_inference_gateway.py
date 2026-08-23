"""LLM provider 解析、失败语义与多模态路由测试。"""

import pytest

from glimmer_cradle.cognition.domain.configuration import (
    ActionStreamSettings, InferenceSettings, LifeClockSettings, LLMSettings,
    ModelSettings, MultimodalSettings,
)
from glimmer_cradle.cognition.domain.exceptions import InferenceException
from glimmer_cradle.cognition.adapters.inference.gateway import LLMEngine, LLMMessage, LLMRequest
from glimmer_cradle.cognition.adapters.inference.multimodal import MultimodalRouter

def ModelConfig(**updates):
    return ModelSettings(max_tokens=1024, temperature=0.8, top_p=0.9,
                         frequency_penalty=0.0, **updates)


def LifeClockConfig(**updates):
    values = dict(heartbeat_enabled=False, heartbeat_interval_ms=45000,
                  focus_duration_ms=20000, ingress_debounce_ms=1400,
                  ingress_focused_debounce_ms=700, ingress_max_batch_messages=4,
                  ingress_max_batch_items=24, summon_keywords=[], focus_on_any_chat=False)
    values.update(updates)
    return LifeClockSettings(**values)


def MultimodalConfig(**updates):
    values = dict(enabled=False, strategy="specialist_then_core", max_items=6,
                  core_model="deepseek", image_model="", video_model="")
    values.update(updates)
    return MultimodalSettings(**values)


def ActionStreamConfig(**updates):
    return ActionStreamSettings(enabled=False, channel="live2d", **updates)


class _SelfEntity:
    class _Inference:
        model = ModelConfig()

    inference_config = _Inference()


def test_llm_provider_resolution_uses_models_contract() -> None:
    """解析 provider 后仍返回新契约 models，不再写旧 model 字段。"""
    llm_config = LLMSettings(
        api_type="deepseek",
        api_key="test-key",
        base_url="https://api.deepseek.com",
        models={"chat": "deepseek-chat"},
        providers={
            "qwen": {
                "api_type": "openai",
                "api_key": "provider-key",
                "base_url": "https://dashscope.aliyuncs.com",
                "models": {"vision": "qwen-vl-plus", "chat": "qwen-plus"},
            }
        },
    )
    engine = LLMEngine(_SelfEntity(), llm_config)

    root_cfg = engine._resolve_provider_config(None)
    vision_cfg = engine._resolve_provider_config("qwen/vision")

    assert root_cfg is not None
    assert root_cfg.models == {"default": "deepseek-chat"}
    assert not hasattr(root_cfg, "model")
    assert vision_cfg is not None
    assert vision_cfg.models == {"default": "qwen-vl-plus"}
    assert vision_cfg.api_key == "provider-key"


def test_llm_gateway_without_real_provider_fails_explicitly() -> None:
    engine = LLMEngine(_SelfEntity(), None)

    with pytest.raises(InferenceException, match="真实 LLM provider"):
        engine.generate(LLMRequest(messages=[LLMMessage(role="user", content="你好")]))


def test_unknown_provider_does_not_fallback_to_default() -> None:
    engine = LLMEngine(
        _SelfEntity(),
        LLMSettings(
            api_type="openai",
            api_key="test-key",
            models={"chat": "test-model"},
        ),
    )

    with pytest.raises(InferenceException, match="未知 LLM provider"):
        engine.generate(
            LLMRequest(messages=[LLMMessage(role="user", content="你好")]),
            provider_key="missing/chat",
        )


def test_multimodal_router_accepts_text_input_with_null_items() -> None:
    """纯文本 model_input 的 items=None 是合法空媒体，不应触发异常回落。"""
    inference = InferenceSettings(
        model=ModelConfig(),
        life_clock=LifeClockConfig(),
        multimodal=MultimodalConfig(enabled=True, strategy="core_direct"),
        action_stream=ActionStreamConfig(),
    )
    router = MultimodalRouter(inference)

    route = router.route({"text": "你好", "modality": ["text"], "items": None})

    assert route.primary_text == "你好"
    assert route.semantic_text == ""
    assert route.vision_messages == []
