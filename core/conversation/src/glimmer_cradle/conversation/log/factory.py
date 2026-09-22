"""Conversation Log 持久化 Adapter 的组装辅助。"""

from __future__ import annotations

from pathlib import Path

from glimmer_cradle.conversation.log.ledger import ConversationLog
from glimmer_cradle.conversation.log.recorder import ConversationRecorder
from glimmer_cradle.conversation.ports import ClockPort, IdGeneratorPort, ObservabilityPort


def build_conversation_recorder(
    base_dir: Path,
    *,
    enabled: bool = True,
    pack_max_size_mb: int = 256,
    flush_interval_ms: int = 500,
    flush_max_buffer: int = 64,
    clock: ClockPort,
    ids: IdGeneratorPort,
    observability: ObservabilityPort,
) -> ConversationRecorder:
    log = ConversationLog(base_dir, pack_max_size_mb=pack_max_size_mb)
    return ConversationRecorder(
        log,
        clock=clock,
        ids=ids,
        observability=observability,
        enabled=enabled,
        flush_interval_ms=flush_interval_ms,
        flush_max_buffer=flush_max_buffer,
    )
