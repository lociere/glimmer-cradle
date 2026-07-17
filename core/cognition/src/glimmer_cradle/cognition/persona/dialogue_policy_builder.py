from __future__ import annotations

from glimmer_cradle.cognition.foundation.config import DialoguePolicyConfig


class DialoguePolicyBuilder:
    """Build prompt instructions for visible reply presentation."""

    def build(self, dialogue_config: DialoguePolicyConfig) -> str:
        presentation = dialogue_config.presentation
        structured = dialogue_config.structured_output

        lines = [
            "[回复呈现]",
            f"- 普通闲聊最多 {presentation.casual_max_sentences} 个短句，单条消息倾向不超过 {presentation.casual_max_chars_per_message} 个字。",
            f"- {presentation.message_split_policy}",
            f"- {presentation.complex_reply_policy}",
        ]
        lines.extend(f"- {self._rule_text(rule)}" for rule in presentation.rules)

        if presentation.forbid_emotion_labels:
            lines.append("- 不在正文开头写情绪标签。")
        if presentation.forbid_stage_directions:
            lines.append("- 不写括号动作、旁白动作或表演说明。")

        lines.append("\n[结构化输出]")
        lines.extend(f"- {self._rule_text(rule)}" for rule in structured.rules)
        if structured.preserve_markdown:
            lines.append("- 用户需要 Markdown 时，保留标题、列表、表格、引用等结构。")
        if structured.preserve_code_blocks:
            lines.append("- 用户需要代码或配置时，保留换行、缩进和必要上下文。")
        if structured.require_fenced_code_blocks:
            lines.append("- 代码必须使用 Markdown fenced code block。")

        return "\n".join(lines)

    @staticmethod
    def _rule_text(rule) -> str:
        return getattr(rule, "root", rule)
