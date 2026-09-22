from __future__ import annotations

from importlib.util import find_spec

import glimmer_cradle.conversation as conversation


def test_public_api_exports_owner_boundaries_without_legacy_modules() -> None:
    for name in (
        "ConversationController",
        "ConversationLog",
        "ConversationRecorder",
        "ConversationStore",
        "ConversationTurn",
        "SqliteTurnStore",
        "TurnController",
        "build_conversation_recorder",
    ):
        assert getattr(conversation, name) is not None

    assert find_spec("glimmer_cradle.conversation.ports") is None
    assert find_spec("glimmer_cradle.conversation.log.ledger") is None
    assert find_spec("glimmer_cradle.conversation.log.recorder") is None
