from __future__ import annotations

from glimmer_cradle.cognition.cycle.reply_text import build_reply_messages, normalize_reply_text


def test_normalize_reply_text_removes_emotion_tags_and_stage_directions() -> None:
    reply = "[开心]（轻轻叹气）我知道啦（摸摸头）不过这件事还是先慢一点"

    assert normalize_reply_text(reply) == "我知道啦不过这件事还是先慢一点"


def test_build_reply_messages_splits_conversational_text() -> None:
    reply = "我觉得可以先停一下，别急着开阶段十。先把工具调用和说话节奏收好，然后再继续往发布形态推进会更稳。"

    messages = build_reply_messages(reply)

    assert len(messages) >= 2
    assert [message["sequence"] for message in messages] == list(range(len(messages)))
    assert all(message["content_type"] == "text" for message in messages)
    assert "".join(message["text"] for message in messages) == reply


def test_build_reply_messages_keeps_structured_code_block() -> None:
    reply = """这里是代码：

```ts
const name = "Selrena";
console.log(name);
```
"""

    messages = build_reply_messages(reply)

    assert messages == [{"sequence": 0, "content_type": "text", "text": reply.strip()}]
