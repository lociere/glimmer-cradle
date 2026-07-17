"""ContextAssembly 与 ContextSource 的预算、排序和失败隔离测试。

聚焦装配编排正确性：并发激活、综合打分、预算裁剪、异常隔离。
同时覆盖版本化记忆进入上下文时的真实相关度与近时度投影。
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from glimmer_cradle.cognition.context import (
    ContextAssembly,
    ContextItem,
    ContextQuery,
    ContextSource,
)
from glimmer_cradle.cognition.context.sources.base import estimate_tokens
from glimmer_cradle.cognition.context.sources.episodic_source import EpisodicMemorySource


class _FixedSource(ContextSource):
    """返回固定候选的测试 source。"""

    def __init__(self, name: str, items: list[ContextItem]) -> None:
        self.name = name
        self._items = items
        self.calls = 0

    async def activate(self, query, *, max_items=10):
        self.calls += 1
        return list(self._items)[:max_items]


class _CrashingSource(ContextSource):
    name = "broken"

    async def activate(self, query, *, max_items=10):
        raise RuntimeError("intentional crash")


class _MemorySourceStub:
    def __init__(self, records: list[SimpleNamespace]) -> None:
        self._records = records

    async def retrieve(self, *args, **kwargs) -> list[SimpleNamespace]:
        return self._records


def _item(source: str, content: str, relevance: float, importance: float = 0.5,
          recency: float = 0.5) -> ContextItem:
    return ContextItem(
        source=source,
        content=content,
        relevance=relevance,
        recency=recency,
        importance=importance,
        token_estimate=estimate_tokens(content),
    )


# ── 并发激活 ────────────────────────────────────────────────────────────

async def test_assembly_calls_all_sources_concurrently() -> None:
    s1 = _FixedSource("episodic", [_item("episodic", "记忆A", 0.7)])
    s2 = _FixedSource("knowledge", [_item("knowledge", "知识A", 0.6)])
    asm = ContextAssembly([s1, s2], base_budget_tokens=10000)
    result = await asm.assemble(ContextQuery(text="hi"))
    assert s1.calls == 1
    assert s2.calls == 1
    assert result.sources_called == 2
    assert result.sources_failed == 0
    assert result.total_count() == 2


async def test_episodic_memory_projects_real_relevance_and_recency() -> None:
    now = datetime.now(timezone.utc)
    source = EpisodicMemorySource(_MemorySourceStub([
        SimpleNamespace(
            memory_id="recent-relevant",
            summary="喜欢草莓蛋糕",
            content="用户喜欢草莓蛋糕",
            salience=0.8,
            updated_at=now.isoformat(),
        ),
        SimpleNamespace(
            memory_id="old-unrelated",
            summary="天气记录",
            content="那天有阵雨",
            salience=0.8,
            updated_at=(now - timedelta(days=30)).isoformat(),
        ),
    ]))

    items = await source.activate(ContextQuery(text="喜欢草莓"))

    assert items[0].relevance > items[1].relevance
    assert items[0].recency > items[1].recency


# ── 综合打分排序 ────────────────────────────────────────────────────────

async def test_items_sorted_by_combined_score_desc() -> None:
    s = _FixedSource("episodic", [
        _item("episodic", "低分", relevance=0.2, importance=0.2, recency=0.2),
        _item("episodic", "高分", relevance=0.9, importance=0.8, recency=0.8),
        _item("episodic", "中分", relevance=0.5, importance=0.5, recency=0.5),
    ])
    asm = ContextAssembly([s], base_budget_tokens=10000)
    result = await asm.assemble(ContextQuery(text="hi"))
    # 排序后 content 顺序：高分→中分→低分
    assert [it.content for it in result.items] == ["高分", "中分", "低分"]


# ── 预算裁剪 ────────────────────────────────────────────────────────────

async def test_budget_factor_zero_truncates_all() -> None:
    s = _FixedSource("knowledge", [_item("knowledge", "X" * 100, 0.9)])
    asm = ContextAssembly([s], base_budget_tokens=10000)
    result = await asm.assemble(ContextQuery(text="hi"), budget_factor=0.0)
    assert result.budget_tokens == 0
    assert result.total_count() == 0
    assert result.was_truncated is True


async def test_budget_cuts_low_priority_items() -> None:
    # 每项 token ≈ 33（"X"*100 / 3）
    s = _FixedSource("knowledge", [
        _item("knowledge", "X" * 100, relevance=0.9),  # ≈33 tokens
        _item("knowledge", "Y" * 100, relevance=0.5),  # ≈33 tokens
        _item("knowledge", "Z" * 100, relevance=0.1),  # ≈33 tokens
    ])
    asm = ContextAssembly([s], base_budget_tokens=70)  # 够 2 个不够 3 个
    result = await asm.assemble(ContextQuery(text="hi"))
    assert len(result.items) == 2
    assert result.was_truncated is True
    # 留下的是高分两个
    contents = [it.content for it in result.items]
    assert "X" * 100 in contents
    assert "Y" * 100 in contents


# ── 异常隔离 ────────────────────────────────────────────────────────────

async def test_crashing_source_does_not_break_assembly() -> None:
    good = _FixedSource("episodic", [_item("episodic", "OK", 0.7)])
    bad = _CrashingSource()
    asm = ContextAssembly([bad, good], base_budget_tokens=10000)
    result = await asm.assemble(ContextQuery(text="hi"))
    assert result.sources_called == 2
    assert result.sources_failed == 1
    assert result.total_count() == 1
    assert result.items[0].content == "OK"


# ── 分组输出 ────────────────────────────────────────────────────────────

async def test_grouped_by_source() -> None:
    s1 = _FixedSource("episodic", [
        _item("episodic", "记忆1", 0.7),
        _item("episodic", "记忆2", 0.6),
    ])
    s2 = _FixedSource("knowledge", [
        _item("knowledge", "知识A", 0.8),
    ])
    asm = ContextAssembly([s1, s2], base_budget_tokens=10000)
    result = await asm.assemble(ContextQuery(text="hi"))
    groups = result.grouped_by_source()
    assert set(groups.keys()) == {"episodic", "knowledge"}
    assert len(groups["episodic"]) == 2
    assert len(groups["knowledge"]) == 1


# ── per_source_limit ────────────────────────────────────────────────────

async def test_per_source_limit_passed_to_source() -> None:
    items = [_item("episodic", f"m{i}", 0.5) for i in range(20)]
    s = _FixedSource("episodic", items)
    asm = ContextAssembly([s], base_budget_tokens=100000)
    result = await asm.assemble(ContextQuery(text="hi"), per_source_limit=5)
    assert result.total_count() == 5


# ── ContextItem.score ───────────────────────────────────────────────────

def test_context_item_score_weighted_sum() -> None:
    import pytest as _pt
    it = _item("episodic", "x", relevance=0.8, importance=0.6, recency=0.4)
    # default weights: r=0.2, i=0.3, R=0.5
    expected = 0.2 * 0.4 + 0.3 * 0.6 + 0.5 * 0.8
    assert it.score() == _pt.approx(expected)


# ── 空源列表 ────────────────────────────────────────────────────────────

async def test_assembly_with_no_sources_returns_empty() -> None:
    asm = ContextAssembly([], base_budget_tokens=1000)
    result = await asm.assemble(ContextQuery(text="hi"))
    assert result.total_count() == 0
    assert result.sources_called == 0


# ── estimate_tokens ─────────────────────────────────────────────────────

def test_estimate_tokens_chinese_english_mix() -> None:
    # 长度 / 3，最少 1
    assert estimate_tokens("") == 1
    assert estimate_tokens("abc") == 1
    assert estimate_tokens("abcdef") == 2
    assert estimate_tokens("a" * 30) == 10
