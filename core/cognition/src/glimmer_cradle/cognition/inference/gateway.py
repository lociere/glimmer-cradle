"""LLM provider 请求、响应解析与观测封装。

设计原则：
1. 仅做真实 provider API 调用，无业务逻辑或模拟 fallback
2. 所有prompt构建、人设注入都在应用层完成，这里仅做纯生成
3. 可插拔替换，更换模型仅需修改这里，核心代码零改动
4. 多 provider 路由：providers 字典按 key 选择不同推理后端
"""
from dataclasses import dataclass, field
import json
import time
import uuid
from typing import Optional
from urllib import error, request
from urllib.parse import urljoin

from glimmer_cradle.cognition.identity.self_entity import SelfEntity
from glimmer_cradle.cognition.foundation.config import LLMConfig
from glimmer_cradle.cognition.foundation.exceptions import InferenceException
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.model_invocations import record_model_invocation

# 初始化模块日志器
logger = get_logger("llm_engine")


def _summarize_llm_config(config: Optional[LLMConfig]) -> dict:
    """返回可安全写入日志的 LLM 配置摘要，不包含 API key 原文。"""
    if not config:
        return {"configured": False}

    providers = config.providers or {}
    provider_summary: dict[str, dict] = {}
    for name, provider in providers.items():
        provider_summary[name] = {
            "api_type": getattr(provider, "api_type", None),
            "base_url_configured": bool(getattr(provider, "base_url", None)),
            "models": sorted((getattr(provider, "models", None) or {}).keys()),
            "api_key_configured": bool(getattr(provider, "api_key", None)),
        }

    return {
        "configured": True,
        "api_type": config.api_type,
        "base_url_configured": bool(config.base_url),
        "models": sorted((config.models or {}).keys()),
        "api_key_configured": bool(config.api_key),
        "providers": provider_summary,
    }


def _first_model(models: dict[str, str] | None) -> str | None:
    return next(iter((models or {}).values()), None)


@dataclass(frozen=True)
class LLMMessage:
    """单条模型消息。

    content 为文字时直接传字符串。
    若需要传图片，使用 vision_url 字段携带图片 URL（仅视觉模型路径使用）。
    """

    role: str
    content: str
    vision_url: str | None = None      # 非 None 时构造 vision 消息（url 图片）
    vision_mime: str | None = None     # 图片 MIME 类型，默认 image/jpeg


@dataclass(frozen=True)
class LLMRequest:
    """消息式推理请求。"""

    messages: list[LLMMessage]
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class LLMApiResult:
    text: str
    payload: dict
    response_data: dict | list | str
    provider_id: str
    model_id: str


def _build_message_payload(messages: list[LLMMessage]) -> list[dict]:
    """将 LLMMessage 列表转为 OpenAI 兼容的消息载荷。

    带 vision_url 的消息构造为 content 数组（image_url + text）格式，
    符合 OpenAI Vision / Qwen-VL / DeepSeek-VL 的 chat/completions 兼容接口。
    """
    result: list[dict] = []
    for msg in messages:
        if not msg.content.strip() and not msg.vision_url:
            continue
        if msg.vision_url:
            content_parts: list[dict] = [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": msg.vision_url,
                        "detail": "auto",
                    },
                }
            ]
            if msg.content.strip():
                content_parts.append({"type": "text", "text": msg.content})
            result.append({"role": msg.role, "content": content_parts})
        else:
            result.append({"role": msg.role, "content": msg.content})
    return result


# ======================================
# LLM推理引擎
# ======================================
class LLMEngine:
    """
    LLM推理引擎，纯算力调用。
    支持多 provider 路由：通过 provider_key 选择 LLMConfig.providers 中的配置。
    """
    def __init__(self, self_entity: SelfEntity, llm_config: Optional[LLMConfig] = None):
        self.self_entity = self_entity
        self.config = self_entity.inference_config.model
        self.llm_config = llm_config
        logger.info(
            "LLM引擎初始化完成",
            llm_config=_summarize_llm_config(self.llm_config),
        )

    def _render_messages_as_prompt(self, llm_request: LLMRequest) -> str:
        sections: list[str] = []
        for message in llm_request.messages:
            content = message.content.strip()
            if not content:
                continue
            sections.append(f"[{message.role}]\n{content}")
        return "\n\n".join(sections)

    def _resolve_provider_config(self, provider_key: str | None) -> LLMConfig | None:
        """将 provider_key 解析为内部可用的 LLMConfig（model 字段已填充）。

        支持三种格式：
          - ``None``           → 使用根配置 models 第一个模型
          - ``"qwen"``         → providers["qwen"].models 第一个模型
          - ``"qwen/vision"``  → providers["qwen"].models["vision"]

        provider 或模型别名不存在时明确失败，禁止静默调用错误模型。
        """
        if not self.llm_config:
            return None

        def _build(base: LLMConfig, resolved_model: str | None, prov: object = None) -> LLMConfig:
            p = prov
            return LLMConfig(
                api_type=getattr(p, "api_type", None) or base.api_type,
                api_key=getattr(p, "api_key", None) or base.api_key,
                base_url=getattr(p, "base_url", None) or base.base_url,
                models={"default": resolved_model} if resolved_model else None,
                temperature=(
                    getattr(p, "temperature", None)
                    if getattr(p, "temperature", None) is not None
                    else base.temperature
                ),
                request_method=getattr(p, "request_method", None),
                request_path=getattr(p, "request_path", None),
                request_headers=getattr(p, "request_headers", None),
                request_body_template=getattr(p, "request_body_template", None),
                response_extract=getattr(p, "response_extract", None),
            )

        # ── provider_key 为 None：解析根配置的默认模型 ─────────
        if not provider_key:
            resolved = _first_model(self.llm_config.models)
            if not resolved:
                logger.warning("根配置 models 为空，无法解析默认模型")
            return _build(self.llm_config, resolved)

        # ── 解析复合格式 "provider/model_alias" ─────────────────
        if "/" in provider_key:
            prov_name, model_alias = provider_key.split("/", 1)
        else:
            prov_name, model_alias = provider_key, None

        providers = self.llm_config.providers or {}
        prov = providers.get(prov_name)
        if not prov:
            raise InferenceException(f"未知 LLM provider: {provider_key}")

        # ── 解析最终模型 ID ──────────────────────────────────────
        prov_models = prov.models or {}
        if model_alias:
            resolved_model = prov_models.get(model_alias)
            if not resolved_model:
                raise InferenceException(
                    f"LLM provider {prov_name} 不存在模型别名 {model_alias}"
                )
        else:
            resolved_model = _first_model(prov_models)

        return _build(self.llm_config, resolved_model, prov)

    def _generate_via_api(self, llm_request: LLMRequest, cfg: LLMConfig, provider_id: str) -> LLMApiResult:
        """通过指定的 LLMConfig（可为 provider 子配置）调用 API 生成回复。"""
        api_type = cfg.api_type.lower().strip()
        api_key = cfg.api_key
        if not api_key:
            raise InferenceException("缺少 LLM API Key，请在配置中提供")

        base_url = (cfg.base_url or "https://api.deepseek.com").rstrip("/")
        request_method = (cfg.request_method or "POST").upper()
        if cfg.request_path:
            request_path = cfg.request_path
        elif api_type in {"deepseek", "openai"}:
            request_path = "/v1/chat/completions"
        else:
            request_path = "/v1/completions"
        endpoint = urljoin(base_url + "/", request_path.lstrip("/"))

        model_name = _first_model(cfg.models)
        if not model_name:
            raise InferenceException("LLM provider 未配置模型")
        prompt_text = self._render_messages_as_prompt(llm_request)
        message_payload = _build_message_payload(llm_request.messages)

        if request_path.endswith("/chat/completions"):
            default_payload: dict = {
                "model": model_name,
                "messages": message_payload,
                "max_tokens": self.config.max_tokens,
                "temperature": cfg.temperature if cfg.temperature is not None else self.config.temperature,
            }
        else:
            default_payload = {
                "model": model_name,
                "prompt": prompt_text,
                "max_tokens": self.config.max_tokens,
                "temperature": cfg.temperature if cfg.temperature is not None else self.config.temperature,
            }

        if cfg.request_body_template:
            template = cfg.request_body_template
            try:
                body_text = template.format(
                    prompt=prompt_text,
                    prompt_json=json.dumps(prompt_text, ensure_ascii=False),
                    messages=json.dumps(message_payload, ensure_ascii=False),
                    messages_json=json.dumps(message_payload, ensure_ascii=False),
                    model=default_payload["model"],
                    temperature=default_payload["temperature"],
                )
                payload = json.loads(body_text)
            except Exception as e:
                raise InferenceException(f"请求体模板解析失败: {str(e)}")
        else:
            payload = default_payload

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        if cfg.request_headers:
            headers.update(cfg.request_headers)

        try:
            req = request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method=request_method,
            )
            with request.urlopen(req, timeout=60) as resp:
                resp_data = json.load(resp)

            if isinstance(resp_data, dict):
                if cfg.response_extract:
                    reply = self._extract_response_field(resp_data, cfg.response_extract)
                    return LLMApiResult(
                        text=reply,
                        payload=payload,
                        response_data=resp_data,
                        provider_id=provider_id,
                        model_id=model_name,
                    )
                if "choices" in resp_data and isinstance(resp_data["choices"], list) and resp_data["choices"]:
                    first = resp_data["choices"][0]
                    if isinstance(first, dict):
                        if "text" in first:
                            return LLMApiResult(
                                text=str(first["text"]).strip(),
                                payload=payload,
                                response_data=resp_data,
                                provider_id=provider_id,
                                model_id=model_name,
                            )
                        if "message" in first and isinstance(first["message"], dict) and "content" in first["message"]:
                            return LLMApiResult(
                                text=str(first["message"]["content"]).strip(),
                                payload=payload,
                                response_data=resp_data,
                                provider_id=provider_id,
                                model_id=model_name,
                            )
                if "result" in resp_data and isinstance(resp_data["result"], str):
                    return LLMApiResult(
                        text=resp_data["result"].strip(),
                        payload=payload,
                        response_data=resp_data,
                        provider_id=provider_id,
                        model_id=model_name,
                    )

            raise InferenceException("无法从LLM响应中提取文本")
        except error.HTTPError as e:
            try:
                body = e.read().decode("utf-8")
            except Exception:
                body = "<无法读取响应体>"
            raise InferenceException(f"LLM API 请求失败: {e.code}, {body}")
        except Exception as e:
            raise InferenceException(f"LLM API 调用失败: {str(e)}")

    def _extract_response_field(self, data: dict, path: str) -> str:
        """按照点分隔路径提取响应字段，路径示例：choices.0.text"""
        parts = [p for p in path.split(".") if p != ""]
        current: object = data
        for part in parts:
            if isinstance(current, list):
                try:
                    current = current[int(part)]
                except Exception:
                    raise InferenceException(f"响应路径解析失败: {path}")
            elif isinstance(current, dict):
                if part not in current:
                    raise InferenceException(f"响应路径不存在: {path}")
                current = current[part]
            else:
                raise InferenceException(f"响应路径类型不匹配: {path}")
        if isinstance(current, str):
            return current.strip()
        return str(current)

    def generate(self, llm_request: LLMRequest, provider_key: str | None = None) -> str:
        """生成回复。

        Args:
            llm_request: 应用层构建好的消息式会话请求（可包含 vision_url 图片）。
            provider_key: 可选 provider 标识（对应 llm.providers 字典 key），
                          不传则使用根配置（llm 节点）。
        Returns:
            LLM 生成的纯文本。
        Raises:
            InferenceException: 生成失败时抛出。
        """
        metadata = llm_request.metadata or {}
        invocation_id = str(metadata.get("invocation_id") or uuid.uuid4().hex)
        purpose = str(metadata.get("purpose") or "unspecified")
        capture_category = str(metadata.get("capture_category") or "other")
        scene_id = str(metadata.get("scene_id") or "") or None
        trace_id = str(metadata.get("trace_id") or "") or None
        started = time.monotonic()
        provider_id = provider_key or "default"
        model_id = "unknown"
        provider_payload: dict | None = None
        raw_response: dict | list | str | None = None
        final_outcome = "failed"
        error_code: str | None = None
        error_summary: str | None = None
        attributes: dict[str, object] = {}
        try:
            cfg = self._resolve_provider_config(provider_key)
            if cfg is None or not cfg.api_type or cfg.api_type.lower() == "local":
                raise InferenceException("未配置可用的真实 LLM provider")
            model_id = _first_model(cfg.models) or model_id
            api_result = self._generate_via_api(
                llm_request, cfg, provider_key or "default"
            )
            reply = api_result.text
            provider_payload = api_result.payload
            raw_response = api_result.response_data
            provider_id = api_result.provider_id
            model_id = api_result.model_id
            logger.debug(
                "LLM API 生成完成",
                provider=provider_id,
                reply_length=len(reply),
            )
            final_outcome = "succeeded"
            return reply.strip()

        except Exception as e:
            error_code = error_code or "inference_error"
            error_summary = str(e)
            if isinstance(e, InferenceException):
                raise
            raise InferenceException(f"LLM生成失败: {str(e)}") from e
        finally:
            try:
                record_model_invocation(
                    invocation_id=invocation_id,
                    purpose=purpose,
                    capture_category=capture_category,
                    provider_id=provider_id,
                    model_id=model_id,
                    prompt_text=self._render_messages_as_prompt(llm_request),
                    normalized_text=locals().get("reply", "") or "",
                    duration_ms=(time.monotonic() - started) * 1000.0,
                    outcome=final_outcome,
                    scene_id=scene_id,
                    provider_payload=provider_payload,
                    raw_response=raw_response,
                    error_code=error_code,
                    error_summary=error_summary,
                    attributes=attributes,
                    trace_id=trace_id,
                )
            except Exception as capture_error:
                logger.warning("模型调用观测记录写入失败", error=str(capture_error))
