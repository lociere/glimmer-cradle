from glimmer_cradle.cognition.cycle.providers import AffectProvider, MemoryProvider
from glimmer_cradle.cognition.cycle.workspace import make_item
from glimmer_cradle.cognition.context.sources.base import ContextItem


class _Emotion:
    def get_state(self):
        return {"emotion_type": "curious", "intensity": 0.8}


class _Assembly:
    def __init__(self):
        self.query = None

    async def assemble(self, query, **_):
        self.query = query
        return type("Result", (), {"items": [ContextItem(
            source="episodic", content="记忆：曾聊过雨天", relevance=0.9,
            importance=0.7, token_estimate=8)]})()


async def test_affect_proposes_current_emotion() -> None:
    items = await AffectProvider(_Emotion()).propose([])
    assert items and items[0].content["emotion_type"] == "curious"


async def test_memory_uses_context_assembly_with_actor_and_scene() -> None:
    assembly = _Assembly()
    provider = MemoryProvider(assembly)
    focus = make_item(source="perception", content={"text": "雨天", "actor_id": "u1",
                                                    "scene_id": "s1"}, salience=1)
    items = await provider.propose([focus])
    assert items[0].content["source_kind"] == "episodic"
    assert assembly.query.actor_id == "u1" and assembly.query.scene_id == "s1"


async def test_memory_skips_without_focus() -> None:
    assert await MemoryProvider(_Assembly()).propose([]) == []
