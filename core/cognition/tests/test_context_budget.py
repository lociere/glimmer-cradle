"""Context retrieval 预算与压缩终止策略。"""

from glimmer_cradle.cognition.context import (
    ContextBudget,
    ContextCompactor,
    ContextItem,
)


def item(content: str, tokens: int) -> ContextItem:
    return ContextItem(source="test", content=content, relevance=1.0, token_estimate=tokens)


def test_budget_never_exceeds_scaled_limit() -> None:
    result = ContextBudget(100).select(
        [item("a", 30), item("b", 30), item("c", 30)], factor=0.5
    )
    assert [value.content for value in result.items] == ["a"]
    assert result.used_tokens == 30
    assert result.limit_tokens == 50
    assert result.truncated is True


def test_compaction_preserves_provenance_and_records_original_size() -> None:
    compacted = ContextCompactor().compact(
        item("abcdefghij" * 10, 40), max_tokens=10
    )
    assert compacted is not None
    assert compacted.token_estimate <= 10
    assert compacted.metadata == {
        "compacted": True,
        "original_token_estimate": 40,
    }


def test_zero_budget_terminates_without_fake_context() -> None:
    assert ContextCompactor().compact(item("important", 3), max_tokens=0) is None
