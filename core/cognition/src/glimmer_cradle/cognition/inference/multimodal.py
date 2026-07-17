"""多模态输入编排与语义描述生成。

两种策略：
  core_direct        — 主模型支持原生视觉（如 Qwen-VL、GPT-4o）：
                       把图片 URL 直接拼入 vision 消息发给主模型，
                       不经过专家模型中转。返回的 semantic_text 为空，
                       由 DeliberationController 注入回复上下文。

  specialist_then_core — 专家分离模式（主模型不支持视觉时）：
                          先用 image_model 对每张图调用一次 vision API
                          获取自然语言描述，再把描述汇总为 semantic_text
                          注入主模型的 system prompt。

架构规范：
  - 本模块是推理层，不触碰业务规则/人设
  - 不引入任何第三方平台字段（QQ号、emoji_id 等）
  - 只使用 PerceptionModalityItem 的通用语义字段：
            modality / uri / mime_type / semantic / metadata["visual_kind"]
  - vision_prompt 根据 visual_kind 动态生成，在文本侧标记图片语义性质
"""
from dataclasses import dataclass, field
from typing import List

from glimmer_cradle.cognition.foundation.config import InferenceConfig
from glimmer_cradle.cognition.protocol.generated.models.perception_event import (
    PerceptionContent,
    PerceptionModalityItem,
)
from glimmer_cradle.cognition.observability.logger import get_logger

logger = get_logger("multimodal_router")


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
        video_items:     原始视频 item
    """
    strategy: str
    primary_text: str
    semantic_text: str
    vision_messages: List[VisionMessage] = field(default_factory=list)
    image_items: List[PerceptionModalityItem] = field(default_factory=list)
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

    def __init__(self, inference_config: InferenceConfig) -> None:
        self._config = inference_config
        self._llm_engine = None   # 由 Composition Root 在组装期注入。

    def set_llm_engine(self, llm_engine: object) -> None:
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
            else PerceptionContent.model_validate(model_input)
        )
        primary_text = content.text or ""

        # 从 items 中分离媒体项，截取到 max_items
        image_items: List[PerceptionModalityItem] = []
        video_items: List[PerceptionModalityItem] = []
        for item in content.items or []:
            total = len(image_items) + len(video_items)
            if total >= mm_config.max_items:
                break
            if item.modality == "image" and item.uri:
                image_items.append(item)
            elif item.modality == "video" and item.uri:
                video_items.append(item)

        if not image_items and not video_items:
            return MultimodalRouteResult(
                strategy=mm_config.strategy,
                primary_text=primary_text,
                semantic_text="",
            )

        if not mm_config.enabled:
            parts: list[str] = []
            if image_items:
                parts.append(f"{len(image_items)}张图片")
            if video_items:
                parts.append(f"{len(video_items)}个视频")
            return MultimodalRouteResult(
                strategy=mm_config.strategy,
                primary_text=primary_text,
                semantic_text=f"[多模态处理已禁用，包含{'、'.join(parts)}，无法识别内容]",
                image_items=image_items,
                video_items=video_items,
            )

        strategy = mm_config.strategy

        # ── core_direct：主模型原生支持视觉，直接构建 vision_messages ──
        if strategy == "core_direct":
            vision_msgs: List[VisionMessage] = []
            for item in image_items:
                vision_msgs.append(VisionMessage(
                    uri=item.uri or "",
                    mime_type=item.mime_type or "image/jpeg",
                    prompt=_build_vision_prompt(item),
                    semantic_text=item.semantic.text if item.semantic else "",
                ))
            for item in video_items:
                vision_msgs.append(VisionMessage(
                    uri=item.uri or "",
                    mime_type=item.mime_type or "video/mp4",
                    prompt=_build_vision_prompt(item),
                    semantic_text=item.semantic.text if item.semantic else "",
                ))
            return MultimodalRouteResult(
                strategy=strategy,
                primary_text=primary_text,
                semantic_text="",
                vision_messages=vision_msgs,
                image_items=image_items,
                video_items=video_items,
            )

        # ── specialist_then_core：专家模型先描述，再注入主模型 ──
        semantic_text = self._run_specialist(
            image_items=image_items,
            video_items=video_items,
            image_provider=mm_config.image_model,
            video_provider=mm_config.video_model,
        )

        logger.debug(
            "多模态路由完成(specialist_then_core)",
            image_count=len(image_items),
            video_count=len(video_items),
        )
        return MultimodalRouteResult(
            strategy=strategy,
            primary_text=primary_text,
            semantic_text=semantic_text,
            image_items=image_items,
            video_items=video_items,
        )

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
            logger.warning("LLMEngine 未注入，多模态专家只保留已有语义")
            return self._fallback_description(image_items, video_items)

        from glimmer_cradle.cognition.inference.gateway import LLMMessage, LLMRequest

        desc_parts: list[str] = []

        for idx, img in enumerate(image_items, 1):
            kind = str((img.metadata or {}).get("visual_kind", "image"))
            label = "表情包" if kind == "sticker" else "图片"
            semantic_text = img.semantic.text.strip() if img.semantic and img.semantic.text else ""
            semantic_resolved = bool(img.semantic.resolved) if img.semantic else False
            # semantic.resolved=true 时，说明 Cortex 已给出可直接消费结果，跳过视觉 API
            if semantic_text and semantic_resolved:
                desc_parts.append(f"[{label}{idx}] {semantic_text}")
                logger.debug("跳过视觉专家，使用 Cortex 预解析描述", index=idx, semantic_text=semantic_text)
                continue
            prompt = _build_vision_prompt(img)
            try:
                req = LLMRequest(messages=[
                    LLMMessage(
                        role="user",
                        content=prompt,
                        vision_url=img.uri,
                        vision_mime=img.mime_type or "image/jpeg",
                    )
                ])
                description = self._llm_engine.generate(req, provider_key=image_provider)
                desc_parts.append(f"[{label}{idx}] {description.strip()}")
                logger.debug(
                    "视觉专家模型描述完成",
                    index=idx, kind=kind, provider=image_provider,
                )
            except Exception as e:
                fallback = semantic_text or f"用户发送了{label}，但视觉能力当前不可用"
                desc_parts.append(f"[{label}{idx}] {fallback}")
                logger.warning("专家视觉调用失败", index=idx, error=str(e))

        for idx, vid in enumerate(video_items, 1):
            semantic_text = vid.semantic.text.strip() if vid.semantic and vid.semantic.text else ""
            semantic_resolved = bool(vid.semantic.resolved) if vid.semantic else False
            # semantic.resolved=true 时，说明 Cortex 已给出可直接消费结果，跳过视觉 API
            if semantic_text and semantic_resolved:
                desc_parts.append(f"[视频{idx}] {semantic_text}")
                logger.debug("跳过视觉专家，使用 Cortex 预解析描述", index=idx, semantic_text=semantic_text)
                continue
            prompt = _build_vision_prompt(vid)
            try:
                req = LLMRequest(messages=[
                    LLMMessage(
                        role="user",
                        content=prompt,
                        vision_url=vid.uri,
                        vision_mime=vid.mime_type or "video/mp4",
                    )
                ])
                description = self._llm_engine.generate(req, provider_key=video_provider)
                desc_parts.append(f"[视频{idx}] {description.strip()}")
                logger.debug(
                    "视觉专家模型描述完成",
                    index=idx, kind="video", provider=video_provider,
                )
            except Exception as e:
                fallback = semantic_text or "用户发送了视频，但视觉能力当前不可用"
                desc_parts.append(f"[视频{idx}] {fallback}")
                logger.warning("专家视频调用失败", index=idx, error=str(e))

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
