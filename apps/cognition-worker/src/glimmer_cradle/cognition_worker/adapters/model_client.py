"""Worker-owned model clients、provider 请求、响应解析与观测封装。

设计原则：
1. 仅做真实 provider API 调用，无业务逻辑或模拟 fallback
2. 所有prompt构建、人设注入都在应用层完成，这里仅做纯生成
3. 可插拔替换，更换模型仅需修改这里，核心代码零改动
4. 多 provider 路由：providers 字典按 key 选择不同推理后端
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
import importlib.util
import json
import os
from pathlib import Path
import threading
import time
import uuid
from typing import List, Literal, Optional, Protocol, TYPE_CHECKING
from urllib import error, request
from urllib.parse import urljoin

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from glimmer_cradle.cognition.inference import (
    InferenceSettings,
    InferenceRequest,
    ModelEvent,
    ModelPort,
    ModelTier,
    ModelSettings,
    InferenceResponse,
)
from glimmer_cradle.cognition.adapters.paths import resolve_cache_dir, resolve_models_dir
from glimmer_cradle.cognition.ports import LoggerPort
from glimmer_cradle.cognition.inference import ModelMessage, ModelRequest
from glimmer_cradle.cognition_worker.adapters.cognition_mapper import (
    inference_request_to_wire,
    model_event_from_wire,
)

class _NullLogger:
    def debug(self, _event: str, **_values: object) -> None: pass
    def info(self, _event: str, **_values: object) -> None: pass
    def warning(self, _event: str, **_values: object) -> None: pass
    def error(self, _event: str, **_values: object) -> None: pass
    def critical(self, _event: str, **_values: object) -> None: pass

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


class _EmbeddingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class EmbeddingRouteSettings(_EmbeddingSettings):
    provider: Literal["dashscope-text-embedding", "local-sentence-transformers"]


class DashScopeEmbeddingSettings(_EmbeddingSettings):
    endpoint: str
    model: str
    dimensions: Literal[64, 128, 256, 512, 768, 1024, 1536, 2048]
    request_timeout_ms: int = Field(ge=1000)
    max_retries: int = Field(ge=0, le=3)


class LocalEmbeddingSettings(_EmbeddingSettings):
    model_path: str
    model_id: str
    auto_download: bool
    device: str
    batch_size: int = Field(ge=1)


class EmbeddingProvidersSettings(_EmbeddingSettings):
    dashscope_text_embedding: DashScopeEmbeddingSettings = Field(
        validation_alias="dashscope-text-embedding"
    )
    local_sentence_transformers: LocalEmbeddingSettings = Field(
        validation_alias="local-sentence-transformers"
    )


class EmbeddingSettings(_EmbeddingSettings):
    enabled: bool
    route: EmbeddingRouteSettings
    providers: EmbeddingProvidersSettings


EmbeddingTextType = Literal["query", "document"]


class EmbeddingProvider(Protocol):
    provider_id: str
    model_id: str

    def is_configured(self) -> bool: ...

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType
    ) -> np.ndarray: ...


class EmbeddingEngine:
    """把选定 provider 投影为 Cognition 使用的稳定向量 Port。"""

    def __init__(
        self, config: EmbeddingSettings | None = None, *, logger: LoggerPort | None = None
    ) -> None:
        self._logger = logger or _NullLogger()
        self._provider: EmbeddingProvider | None = None
        if config is None or not config.enabled:
            self._logger.info("语义向量增强未启用，基础召回保持就绪")
            return
        provider_id = str(config.route.provider)
        if provider_id == "dashscope-text-embedding":
            self._provider = _DashScopeEmbeddingProvider(
                config.providers.dashscope_text_embedding,
                api_key=os.environ.get("DASHSCOPE_API_KEY", "").strip(),
            )
        elif provider_id == "local-sentence-transformers":
            self._provider = _LocalSentenceTransformersProvider(
                config.providers.local_sentence_transformers
            )
        else:
            raise ValueError(f"未知 Embedding provider: {provider_id}")
        if self._provider.is_configured():
            self._logger.info(
                "语义向量增强已配置",
                provider_id=self._provider.provider_id,
                model_id=self._provider.model_id,
            )
        else:
            self._logger.warning(
                "语义向量增强已启用但 provider 配置不完整",
                provider_id=self._provider.provider_id,
            )

    def is_available(self) -> bool:
        return self._provider is not None and self._provider.is_configured()

    @property
    def model_id(self) -> str:
        return self._provider.model_id if self._provider is not None else ""

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType = "document"
    ) -> np.ndarray:
        if not self.is_available() or self._provider is None:
            raise RuntimeError("语义向量增强未配置")
        if not texts:
            return np.empty((0, 0), dtype=np.float32)
        return await self._provider.encode(texts, text_type=text_type)

    async def encode_single(
        self, text: str, *, text_type: EmbeddingTextType = "query"
    ) -> np.ndarray:
        return (await self.encode([text], text_type=text_type))[0]

    @staticmethod
    def cosine_similarities(query_vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return np.zeros(matrix.shape[0])
        row_norms = np.linalg.norm(matrix, axis=1)
        row_norms = np.where(row_norms == 0, 1.0, row_norms)
        return (matrix @ query_vec) / (row_norms * query_norm)


class _DashScopeEmbeddingProvider:
    provider_id = "dashscope-text-embedding"
    _MAX_BATCH_SIZE = 10

    def __init__(self, config: DashScopeEmbeddingSettings, *, api_key: str) -> None:
        self._config = config
        self._api_key = api_key
        self.model_id = f"{self.provider_id}:{config.model}:{int(config.dimensions)}"

    def is_configured(self) -> bool:
        return bool(self._api_key and self._config.model and self._config.endpoint)

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType
    ) -> np.ndarray:
        batches = [
            texts[index : index + self._MAX_BATCH_SIZE]
            for index in range(0, len(texts), self._MAX_BATCH_SIZE)
        ]
        results: list[np.ndarray] = []
        for batch in batches:
            results.extend(
                await asyncio.to_thread(self._request_batch, batch, text_type)
            )
        return np.asarray(results, dtype=np.float32)

    def _request_batch(
        self, texts: list[str], text_type: EmbeddingTextType
    ) -> list[np.ndarray]:
        payload = {
            "model": self._config.model,
            "input": {"texts": texts},
            "parameters": {
                "text_type": text_type,
                "dimension": int(self._config.dimensions),
                "output_type": "dense",
            },
        }
        req = request.Request(
            str(self._config.endpoint),
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        attempts = int(self._config.max_retries) + 1
        for attempt in range(attempts):
            try:
                with request.urlopen(
                    req, timeout=int(self._config.request_timeout_ms) / 1000
                ) as response:
                    body = json.load(response)
                return self._parse_response(body, expected=len(texts))
            except (error.HTTPError, error.URLError, TimeoutError, ValueError) as exc:
                if attempt + 1 >= attempts:
                    raise RuntimeError(
                        f"DashScope Embedding 请求失败: {type(exc).__name__}"
                    ) from exc
                time.sleep(0.25 * (attempt + 1))
        raise RuntimeError("DashScope Embedding 请求失败")

    def _parse_response(self, body: object, *, expected: int) -> list[np.ndarray]:
        if not isinstance(body, dict):
            raise ValueError("Embedding 响应不是对象")
        output = body.get("output")
        embeddings = output.get("embeddings") if isinstance(output, dict) else None
        if not isinstance(embeddings, list) or len(embeddings) != expected:
            raise ValueError("Embedding 响应数量不匹配")
        ordered = sorted(
            embeddings,
            key=lambda item: int(item.get("text_index", 0))
            if isinstance(item, dict)
            else 0,
        )
        vectors: list[np.ndarray] = []
        for item in ordered:
            vector = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(vector, list) or len(vector) != int(
                self._config.dimensions
            ):
                raise ValueError("Embedding 响应维度不匹配")
            vectors.append(np.asarray(vector, dtype=np.float32))
        return vectors


class _LocalSentenceTransformersProvider:
    provider_id = "local-sentence-transformers"

    def __init__(self, config: LocalEmbeddingSettings) -> None:
        self._config = config
        self._model: SentenceTransformer | None = None
        self._load_lock = threading.Lock()
        self._model_path = self._resolve_model_path(config.model_path)
        identity = (
            str(self._model_path) if self._model_path.exists() else config.model_id
        )
        self.model_id = f"{self.provider_id}:{identity}"

    def is_configured(self) -> bool:
        package_available = importlib.util.find_spec("sentence_transformers") is not None
        source_available = self._model_path.exists() or bool(
            self._config.auto_download and self._config.model_id
        )
        return package_available and source_available

    async def encode(
        self, texts: list[str], *, text_type: EmbeddingTextType
    ) -> np.ndarray:
        del text_type
        return await asyncio.to_thread(self._encode_sync, texts)

    def _encode_sync(self, texts: list[str]) -> np.ndarray:
        model = self._ensure_model()
        vectors = model.encode(
            texts,
            batch_size=int(self._config.batch_size),
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        return np.asarray(vectors, dtype=np.float32)

    def _ensure_model(self) -> SentenceTransformer:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            from sentence_transformers import SentenceTransformer

            if self._model_path.exists():
                source = str(self._model_path)
            elif self._config.auto_download and self._config.model_id:
                source = self._config.model_id
            else:
                raise RuntimeError("本地 Embedding 模型未配置")
            model = SentenceTransformer(
                source,
                device=self._config.device,
                cache_folder=str(
                    resolve_cache_dir() / "models" / "sentence-transformers"
                ),
            )
            if not self._model_path.exists() and self._config.auto_download:
                self._model_path.parent.mkdir(parents=True, exist_ok=True)
                model.save(str(self._model_path))
            self._model = model
            return model

    @staticmethod
    def _resolve_model_path(model_path: str) -> Path:
        raw = Path(model_path)
        return raw if raw.is_absolute() else resolve_models_dir() / raw


class _GatewaySettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class LLMRouteSettings(_GatewaySettings):
    provider: str | None = None
    model_alias: str | None = None


class LLMProviderSettings(_GatewaySettings):
    api_type: str
    api_key: str | None = None
    base_url: str | None = None
    models: dict[str, str]
    temperature: float | None = None
    request_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    request_path: str | None = None
    request_headers: dict[str, str] | None = None
    request_body_template: str | None = None
    response_extract: str | None = None


class LLMSettings(_GatewaySettings):
    default_route: LLMRouteSettings | None = None
    api_type: str
    api_key: str | None = None
    base_url: str | None = None
    models: dict[str, str] | None = None
    temperature: float | None = None
    providers: dict[str, LLMProviderSettings] | None = None
    request_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    request_path: str | None = None
    request_headers: dict[str, str] | None = None
    request_body_template: str | None = None
    response_extract: str | None = None


class InferenceException(RuntimeError):
    """真实推理 provider 调用或响应映射失败。"""

    code = "INFERENCE_ERROR"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(f"[{self.code}] {message}")


class ModelTransport(Protocol):
    def stream(
        self, payload: dict[str, object]
    ) -> AsyncIterator[dict[str, object]]: ...

    async def cancel(self, session_id: str) -> None: ...


class ModelClient:
    """实现 Cognition RealtimeModelPort 的 Worker model client。"""

    def __init__(self, transport: ModelTransport) -> None:
        self._transport = transport

    async def events(self, request: InferenceRequest) -> AsyncIterator[ModelEvent]:
        previous = -1
        async for raw in self._transport.stream(inference_request_to_wire(request)):
            event = model_event_from_wire(raw)
            if event.sequence <= previous:
                raise ValueError("model event sequence must increase")
            previous = event.sequence
            yield event

    async def cancel(self, session_id: str) -> None:
        await self._transport.cancel(session_id)


class CloudReasoning:
    """将同步 provider 调用包装为不阻塞事件循环的云推理后端。"""

    def __init__(self, llm_engine: LLMEngine) -> None:
        self._llm = llm_engine

    async def generate(self, req: InferenceRequest) -> InferenceResponse:
        messages = [ModelMessage(role="system", content=req.system)]
        for prompt, uri, mime in req.vision:
            messages.append(
                ModelMessage(
                    role="user",
                    content=prompt,
                    vision_url=uri,
                    vision_mime=mime,
                )
            )
        messages.append(ModelMessage(role="user", content=req.user))
        llm_req = ModelRequest(messages=messages, metadata=dict(req.metadata))
        started = time.monotonic()
        text = await asyncio.to_thread(self._llm.generate, llm_req, req.provider_key)
        duration_ms = (time.monotonic() - started) * 1000.0
        return InferenceResponse(
            text=text,
            tier_used=ModelTier.CLOUD_ALLOWED,
            duration_ms=duration_ms,
        )


def _summarize_llm_config(config: Optional[LLMSettings]) -> dict:
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
class LLMApiResult:
    text: str
    payload: dict
    response_data: dict | list | str
    provider_id: str
    model_id: str


def _build_message_payload(messages: list[ModelMessage]) -> list[dict]:
    """将 ModelMessage 列表转为 OpenAI 兼容的消息载荷。

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
    支持多 provider 路由：通过 provider_key 选择 LLMSettings.providers 中的配置。
    """
    def __init__(
        self,
        model_config: ModelSettings,
        llm_config: Optional[LLMSettings] = None,
        *,
        logger: LoggerPort | None = None,
        invocation_recorder: Callable[..., None] | None = None,
    ):
        self.config = model_config
        self.llm_config = llm_config
        self._logger = logger or _NullLogger()
        self._record_model_invocation = invocation_recorder
        self._logger.info(
            "LLM引擎初始化完成",
            llm_config=_summarize_llm_config(self.llm_config),
        )

    def _render_messages_as_prompt(self, llm_request: ModelRequest) -> str:
        sections: list[str] = []
        for message in llm_request.messages:
            content = message.content.strip()
            if not content:
                continue
            sections.append(f"[{message.role}]\n{content}")
        return "\n\n".join(sections)

    def _resolve_provider_config(self, provider_key: str | None) -> LLMSettings | None:
        """将 provider_key 解析为内部可用的 LLMSettings（model 字段已填充）。

        支持三种格式：
          - ``None``           → 使用根配置 models 第一个模型
          - ``"qwen"``         → providers["qwen"].models 第一个模型
          - ``"qwen/vision"``  → providers["qwen"].models["vision"]

        provider 或模型别名不存在时明确失败，禁止静默调用错误模型。
        """
        if not self.llm_config:
            return None

        def _build(base: LLMSettings, resolved_model: str | None, prov: object = None) -> LLMSettings:
            p = prov
            return LLMSettings(
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
                self._logger.warning("根配置 models 为空，无法解析默认模型")
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

    def _generate_via_api(self, llm_request: ModelRequest, cfg: LLMSettings, provider_id: str) -> LLMApiResult:
        """通过指定的 LLMSettings（可为 provider 子配置）调用 API 生成回复。"""
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

    def generate(self, llm_request: ModelRequest, provider_key: str | None = None) -> str:
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
            self._logger.debug(
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
                if self._record_model_invocation is not None:
                    self._record_model_invocation(
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
                self._logger.warning("模型调用观测记录写入失败", error=str(capture_error))


class ContentAssetReader(Protocol):
    """Worker 注入的受验证 Content 资产读取能力。"""

    def verify(self, ref: dict) -> object: ...

    def image_data_url(self, ref: dict) -> str: ...


class PerceptionSemantic(BaseModel):
    text: str = ""
    resolved: bool = False


class PerceptionModalityItem(BaseModel):
    modality: str
    uri: str | None = None
    mime_type: str | None = None
    semantic: PerceptionSemantic | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class PerceptionContent(BaseModel):
    text: str = ""
    items: list[PerceptionModalityItem] = Field(default_factory=list)
    parts: list[dict] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────
# 结果数据类
# ─────────────────────────────────────────────────────────────────

@dataclass
class VisionMessage:
    """供主模型直接消费的单个视觉消息（仅 core_direct 策略使用）。"""
    uri: str
    mime_type: str
    prompt: str           # 给模型的提示（如"这是一张表情包，请描述其情绪和动作"）
    semantic_text: str = ""  # Cortex 预置语义文本，可供上层调试/观测


@dataclass
class MultimodalRouteResult:
    """多模态路由输出。

    Attributes:
        strategy:        实际使用的策略
        primary_text:    原始文本部分（来自 content.text）
        semantic_text:   specialist_then_core 专家描述结果，注入 system prompt；
                         core_direct 策略下为空字符串
        vision_messages: core_direct 策略下供主模型直接使用的视觉消息列表；
                         specialist_then_core 策略下为空
        image_items:     原始图片 item（供外部需要时使用）
        audio_items:     音频 item；只消费可信转写，不送视觉 provider
        video_items:     原始视频 item
    """
    strategy: str
    primary_text: str
    semantic_text: str
    vision_messages: List[VisionMessage] = field(default_factory=list)
    image_items: List[PerceptionModalityItem] = field(default_factory=list)
    audio_items: List[PerceptionModalityItem] = field(default_factory=list)
    video_items: List[PerceptionModalityItem] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────
# 视觉 prompt 生成（按语义分类调整，不含任何平台私有字段）
# ─────────────────────────────────────────────────────────────────

_VISUAL_KIND_PROMPTS: dict[str, str] = {
    "sticker": (
        "这是用户发给你的一张表情包。"
        "请用一句话（不超过20字）描述它传达的核心情绪或含义，例如：'表示开心/撒娇/无语/惊讶'。"
        "不要描述画面构图、人物外貌、服装颜色等视觉细节，只给出情感判断。"
    ),
    "image": (
        "这是用户发给你的一张图片。"
        "请用一句话（不超过30字）描述图片的核心内容或用户意图。"
        "简洁优先，不要展开细节描述。"
    ),
    "video": (
        "这是用户发给你的一段视频。"
        "请用一句话（不超过30字）描述视频的主要内容或主题。"
    ),
}

def _build_vision_prompt(item: PerceptionModalityItem) -> str:
    """根据 visual_kind 选择合适的视觉提示词，并附加 semantic 文本。"""
    kind = str((item.metadata or {}).get("visual_kind", "image"))
    base_prompt = _VISUAL_KIND_PROMPTS.get(kind, _VISUAL_KIND_PROMPTS["image"])
    semantic_text = item.semantic.text.strip() if item.semantic and item.semantic.text else ""
    if semantic_text:
        base_prompt = f"{base_prompt}（附加提示：{semantic_text}）"
    return base_prompt


# ─────────────────────────────────────────────────────────────────
# 路由器主体
# ─────────────────────────────────────────────────────────────────

class MultimodalRouter:
    """多模态双路径路由器。

    依赖 LLMEngine 执行实际的视觉 API 调用（specialist_then_core 策略）。
    LLMEngine 在 container 中初始化后通过 set_llm_engine() 注入，避免循环依赖。
    """

    def __init__(
        self,
        inference_config: InferenceSettings,
        asset_reader: ContentAssetReader | None = None,
        *,
        logger: LoggerPort | None = None,
    ) -> None:
        self._config = inference_config
        self._llm_engine: ModelPort | None = None   # 由 Composition Root 在组装期注入。
        self._assets = asset_reader
        self._logger = logger or _NullLogger()

    def set_llm_engine(self, llm_engine: ModelPort) -> None:
        """注入 LLMEngine 实例（避免构造时循环依赖）。"""
        self._llm_engine = llm_engine

    # 同步入口由 PerceptionAppraiser 放入工作线程，避免阻塞认知循环。

    def route(
        self, model_input: PerceptionContent | dict | None
    ) -> MultimodalRouteResult:
        """执行多模态路由，返回结构化结果。

        specialist_then_core 策略下会同步调用专家视觉 API（通过 asyncio.run 或
        已有事件循环下的 run_until_complete），因此调用方必须将本方法放在线程执行器中
        （asyncio.to_thread）而非直接 await。
        """
        mm_config = self._config.multimodal
        empty = MultimodalRouteResult(strategy=mm_config.strategy, primary_text="", semantic_text="")

        if not model_input:
            return empty

        content = (
            model_input
            if isinstance(model_input, PerceptionContent)
            else PerceptionContent.model_validate({
                **model_input,
                "items": model_input.get("items") or [],
            })
        )
        primary_text = content.text or ""

        # v5 Content 优先；v4 URI-only items 只在迁移窗口内当拍读取。
        normalized_items = list(content.items or [])
        file_descriptions: list[str] = []
        for part in content.parts or []:
            value = part.get("content") if isinstance(part, dict) else None
            if not isinstance(value, dict):
                continue
            kind = next((key for key in ("text", "image", "audio", "video", "file") if key in value), None)
            if kind == "text" and not primary_text:
                primary_text = str(value[kind])
            elif kind in ("image", "audio", "video", "file"):
                payload = value[kind]
                ref = payload.get("asset") if kind == "file" and isinstance(payload, dict) else payload
                if not isinstance(ref, dict):
                    continue
                semantic = part.get("semantic") or {}
                if not isinstance(semantic, dict):
                    semantic = {}
                uri = None
                try:
                    if self._assets is None:
                        raise ValueError("Content 资产读取能力未装配")
                    if kind == "image":
                        uri = self._assets.image_data_url(ref)
                    else:
                        self._assets.verify(ref)
                except (OSError, ValueError, TypeError) as exc:
                    self._logger.warning("资产读取降级", asset_id=ref.get("asset_id"), error=str(exc))
                if kind == "file":
                    file_descriptions.append(
                        f"[文件] {semantic.get('text') or '用户提供了文件，但当前没有文件理解能力'}"
                    )
                    continue
                normalized_items.append(PerceptionModalityItem(
                    modality=kind, uri=uri, mime_type=str(ref.get("media_type") or ""),
                    semantic=PerceptionSemantic.model_validate(semantic),
                ))

        # 从规范项与旧 items 中分离媒体项，截取到 max_items
        image_items: List[PerceptionModalityItem] = []
        audio_items: List[PerceptionModalityItem] = []
        video_items: List[PerceptionModalityItem] = []
        for item in normalized_items:
            total = len(image_items) + len(audio_items) + len(video_items)
            if total >= mm_config.max_items:
                break
            # 历史 CQ:record 事件被编码为 video + audio/*；读取时仍按音频处理。
            if item.modality == "audio" or (
                item.modality == "video" and (item.mime_type or "").startswith("audio/")
            ):
                audio_items.append(item)
            elif item.modality == "image":
                image_items.append(item)
            elif item.modality == "video":
                video_items.append(item)

        if not image_items and not audio_items and not video_items:
            return MultimodalRouteResult(
                strategy=mm_config.strategy,
                primary_text=primary_text,
                semantic_text="\n".join(file_descriptions),
            )

        if not mm_config.enabled:
            parts: list[str] = []
            if image_items:
                parts.append(f"{len(image_items)}张图片")
            if video_items:
                parts.append(f"{len(video_items)}个视频")
            unavailable = f"[多模态处理已禁用，包含{'、'.join(parts)}，无法识别内容]" if parts else ""
            return MultimodalRouteResult(
                strategy=mm_config.strategy,
                primary_text=primary_text,
                semantic_text="\n".join(part for part in (
                    unavailable, *self._audio_descriptions(audio_items), *file_descriptions,
                ) if part),
                image_items=image_items,
                audio_items=audio_items,
                video_items=video_items,
            )

        strategy = mm_config.strategy

        # ── core_direct：主模型原生支持视觉，直接构建 vision_messages ──
        if strategy == "core_direct":
            vision_msgs: List[VisionMessage] = []
            for item in image_items:
                if not item.uri:
                    continue
                vision_msgs.append(VisionMessage(
                    uri=item.uri or "",
                    mime_type=item.mime_type or "image/jpeg",
                    prompt=_build_vision_prompt(item),
                    semantic_text=item.semantic.text if item.semantic else "",
                ))
            return MultimodalRouteResult(
                strategy=strategy,
                primary_text=primary_text,
                semantic_text="\n".join((
                    *self._audio_descriptions(audio_items),
                    *self._fallback_description([item for item in image_items if not item.uri], video_items).splitlines(),
                    *file_descriptions,
                )),
                vision_messages=vision_msgs,
                image_items=image_items,
                audio_items=audio_items,
                video_items=video_items,
            )

        # ── specialist_then_core：专家模型先描述，再注入主模型 ──
        semantic_text = self._run_specialist(
            image_items=image_items,
            video_items=video_items,
            image_provider=mm_config.image_model,
            video_provider=mm_config.video_model,
        )

        self._logger.debug(
            "多模态路由完成(specialist_then_core)",
            image_count=len(image_items),
            video_count=len(video_items),
        )
        return MultimodalRouteResult(
            strategy=strategy,
            primary_text=primary_text,
            semantic_text="\n".join(part for part in (
                semantic_text, *self._audio_descriptions(audio_items), *file_descriptions
            ) if part),
            image_items=image_items,
            audio_items=audio_items,
            video_items=video_items,
        )

    @staticmethod
    def _audio_descriptions(items: List[PerceptionModalityItem]) -> list[str]:
        descriptions: list[str] = []
        for index, item in enumerate(items, 1):
            semantic = item.semantic
            transcript = semantic.text.strip() if semantic and semantic.resolved else ""
            descriptions.append(
                f"[语音{index}] {transcript or '用户发送了语音，但当前没有可用的转写文本'}"
            )
        return descriptions

    def _run_specialist(
        self,
        image_items: List[PerceptionModalityItem],
        video_items: List[PerceptionModalityItem],
        image_provider: str,
        video_provider: str,
    ) -> str:
        """调用专家视觉模型对每个媒体项生成自然语言描述，汇总为字符串。

        每项调用均向 LLMEngine.generate() 发送包含 vision_url 的单轮请求。
        API 调用失败时只保留已有可信语义或明确的能力不可用状态，不伪造媒体内容。
        """
        if self._llm_engine is None:
            self._logger.warning("LLMEngine 未注入，多模态专家只保留已有语义")
            return self._fallback_description(image_items, video_items)

        desc_parts: list[str] = []

        for idx, img in enumerate(image_items, 1):
            kind = str((img.metadata or {}).get("visual_kind", "image"))
            label = "表情包" if kind == "sticker" else "图片"
            semantic_text = img.semantic.text.strip() if img.semantic and img.semantic.text else ""
            semantic_resolved = bool(img.semantic.resolved) if img.semantic else False
            # semantic.resolved=true 时，说明 Cortex 已给出可直接消费结果，跳过视觉 API
            if semantic_text and semantic_resolved:
                desc_parts.append(f"[{label}{idx}] {semantic_text}")
                self._logger.debug("跳过视觉专家，使用 Cortex 预解析描述", index=idx, semantic_text=semantic_text)
                continue
            if not img.uri:
                desc_parts.append(f"[{label}{idx}] {semantic_text or '用户发送了图片，但视觉能力当前不可用'}")
                continue
            prompt = _build_vision_prompt(img)
            try:
                req = ModelRequest(messages=[
                    ModelMessage(
                        role="user",
                        content=prompt,
                        vision_url=img.uri,
                        vision_mime=img.mime_type or "image/jpeg",
                    )
                ])
                description = self._llm_engine.generate(req, provider_key=image_provider)
                desc_parts.append(f"[{label}{idx}] {description.strip()}")
                self._logger.debug(
                    "视觉专家模型描述完成",
                    index=idx, kind=kind, provider=image_provider,
                )
            except Exception as e:
                fallback = semantic_text or f"用户发送了{label}，但视觉能力当前不可用"
                desc_parts.append(f"[{label}{idx}] {fallback}")
                self._logger.warning("专家视觉调用失败", index=idx, error=str(e))

        for idx, vid in enumerate(video_items, 1):
            semantic_text = vid.semantic.text.strip() if vid.semantic and vid.semantic.text else ""
            semantic_resolved = bool(vid.semantic.resolved) if vid.semantic else False
            # semantic.resolved=true 时，说明 Cortex 已给出可直接消费结果，跳过视觉 API
            if semantic_text and semantic_resolved:
                desc_parts.append(f"[视频{idx}] {semantic_text}")
                self._logger.debug("跳过视觉专家，使用 Cortex 预解析描述", index=idx, semantic_text=semantic_text)
                continue
            # 当前 provider 仅有 image_url 输入契约，视频按能力降级。
            desc_parts.append(f"[视频{idx}] {semantic_text or '用户发送了视频，但视觉能力当前不可用'}")

        return "\n".join(desc_parts)

    @staticmethod
    def _fallback_description(
        image_items: List[PerceptionModalityItem],
        video_items: List[PerceptionModalityItem],
    ) -> str:
        parts: list[str] = []
        for idx, img in enumerate(image_items, 1):
            kind = str((img.metadata or {}).get("visual_kind", "image"))
            label = "表情包" if kind == "sticker" else "图片"
            semantic_text = img.semantic.text.strip() if img.semantic and img.semantic.text else ""
            desc = semantic_text or f"用户发送了{label}，但视觉能力当前不可用"
            parts.append(f"[{label}{idx}] {desc}")
        for idx, vid in enumerate(video_items, 1):
            semantic_text = vid.semantic.text.strip() if vid.semantic and vid.semantic.text else ""
            desc = semantic_text or "用户发送了视频，但视觉能力当前不可用"
            parts.append(f"[视频{idx}] {desc}")
        return "\n".join(parts)
