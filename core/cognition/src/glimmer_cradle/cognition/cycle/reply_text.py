"""
文件名称：reply_text.py
所属层级：认知循环 —— 回复文本处理工具

核心作用：清洗 LLM 回复里的非正文标记，供「存入记忆/会话历史」和出站投递前复用。
情绪与身体动作由独立投影处理，正文只保留用户可见语言；否则标签、括号动作会随
历史回灌进下一轮 LLM 上下文，污染生成。

由 ActionEmitter 与 CycleContinuity 共同使用，确保外发和历史写入文本一致。
"""
from __future__ import annotations

import re
from typing import Any

# 当前角色人设全量情绪标签正则（与 persona_injector.py 及 perception-builder.ts 同步维护）
# 覆盖括号格式 [开心]、[emotion:happy] 及无括号前缀 emotion: happy
_EMOTION_LABEL_WORDS = (
    r'平静|开心|疑惑|撒娇|严肃|害羞|生气|委屈|思考'           # persona 明确标签
    r'|高兴|愉快|愤怒|难过|傲娇|好奇|冷静|激动|无奈|担心|兴奋'  # 扩展同义词
    r'|calm|happy|curious|coy|tsundere|shy|angry|aggrieved|thinking'  # 英文别名
    r'|joyful|pleased|furious|sad|peaceful|worried|excited|sulky'
)
# 括号包裹格式（任意位置）：[开心] [emotion:happy] (calm) 《思考》 等
_EMOTION_TAG_RE = re.compile(
    r'[\[\(（【《<]\s*(?:emotion|情绪)?\s*[:：\-]?\s*(?:' + _EMOTION_LABEL_WORDS + r')\s*[\]\)）】》>]',
    re.IGNORECASE,
)
# 无括号前缀格式（仅行首）：emotion: happy 情绪：开心
_EMOTION_PREFIX_RE = re.compile(
    r'^(?:emotion|情绪)\s*[:：]\s*(?:' + _EMOTION_LABEL_WORDS + r')\s*',
    re.IGNORECASE,
)

_STAGE_DIRECTION_RE = re.compile(r'[\(（]\s*([^()（）\n]{1,24})\s*[\)）]')
_CODE_FENCE_RE = re.compile(r'```[\s\S]*?```')
_ACTION_CUES = (
    "笑", "叹", "看", "望", "摸", "抱", "拍", "揉", "眨", "歪", "点头", "摇头",
    "挥手", "低头", "抬头", "皱眉", "托腮", "捂脸", "扶额", "耸肩", "靠近",
    "凑近", "退后", "递", "坐", "站", "走", "伸手", "收手", "拉", "推",
    "摊手", "眯眼", "抿嘴", "咳", "沉默", "停顿", "轻声", "小声", "脸红",
)


def strip_emotion_tags(text: str) -> str:
    """剥除 LLM 输出中的全部情绪标签，供存入记忆前使用。

    处理范围：
      - 括号格式（任意位置）：[开心] [emotion:happy] (shy) 等
      - 无括号前缀（行首）：emotion: happy / 情绪：开心
    """
    value = _EMOTION_TAG_RE.sub('', text).strip()
    value = _EMOTION_PREFIX_RE.sub('', value).strip()
    return re.sub(r' {2,}', ' ', value).strip()


def normalize_reply_text(text: str) -> str:
    """把模型回复归一化成用户可见正文。

    规则只处理高置信度格式噪声：情绪标签、纯动作括号、过多空白。技术内容和代码块不
    改写，避免破坏用户要求的可复制输出。
    """
    value = strip_emotion_tags(text)
    value = _remove_stage_directions(value)
    value = re.sub(r'[ \t]{2,}', ' ', value)
    value = re.sub(r'\n{3,}', '\n\n', value)
    return value.strip()


def build_reply_messages(text: str) -> list[dict[str, Any]]:
    """为自然聊天生成 ActionReplyMessage 分段。

    `payload.text` 仍保存完整语义；这里仅给桌面/平台投递一个更像日常聊天的切分。
    含代码块、列表或表格的回复保持单条，避免破坏可复制结构。
    """
    value = normalize_reply_text(text)
    if not value:
        return []
    if _is_structured_output(value):
        return [{"sequence": 0, "content_type": "text", "text": value}]

    chunks = _split_conversational_text(value)
    return [
        {"sequence": index, "content_type": "text", "text": chunk}
        for index, chunk in enumerate(chunks)
    ]


def _remove_stage_directions(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        return "" if _looks_like_stage_direction(inner) else match.group(0)

    value = _STAGE_DIRECTION_RE.sub(replace, text)
    return re.sub(r'[ \t]{2,}', ' ', value).strip()


def _looks_like_stage_direction(inner: str) -> bool:
    if not inner:
        return False
    if any(ch.isascii() and ch.isalnum() for ch in inner):
        return False
    compact = re.sub(r'[\s，,。.!！?？、~～…]+', '', inner)
    if not compact:
        return False
    return any(cue in compact for cue in _ACTION_CUES)


def _is_structured_output(text: str) -> bool:
    if _CODE_FENCE_RE.search(text):
        return True
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if any(line.startswith(("- ", "* ", "> ", "|", "#")) for line in lines):
        return True
    if any(re.match(r'^\d+[.)、]\s+', line) for line in lines):
        return True
    return False


def _split_conversational_text(text: str, *, max_chars: int = 42) -> list[str]:
    paragraphs = [part.strip() for part in text.splitlines() if part.strip()]
    pieces: list[str] = []
    for paragraph in paragraphs:
        pieces.extend(_split_paragraph(paragraph, max_chars=max_chars))
    return pieces or [text]


def _split_paragraph(paragraph: str, *, max_chars: int) -> list[str]:
    raw_parts = re.findall(r'[^。！？!?；;，,\n]{1,80}[。！？!?；;，,]?', paragraph)
    if not raw_parts:
        raw_parts = [paragraph]

    chunks: list[str] = []
    current = ""
    for raw in raw_parts:
        part = raw.strip()
        if not part:
            continue
        if len(part) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_wrap(part, max_chars=max_chars))
            continue
        if not current:
            current = part
            continue
        if len(current) + len(part) <= max_chars:
            current += part
        else:
            chunks.append(current)
            current = part
    if current:
        chunks.append(current)
    return chunks


def _hard_wrap(text: str, *, max_chars: int) -> list[str]:
    return [
        text[index:index + max_chars].strip()
        for index in range(0, len(text), max_chars)
        if text[index:index + max_chars].strip()
    ]
