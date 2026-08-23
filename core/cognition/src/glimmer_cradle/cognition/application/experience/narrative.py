"""Episode 时间线查询用例。"""

from glimmer_cradle.cognition.domain.experience.narrative import NarrativeEntry, render_episode
from glimmer_cradle.cognition.ports.persistence import EpisodeProjectionPort


class NarrativeJournal:
    def __init__(self, episodes: EpisodeProjectionPort) -> None:
        self._episodes = episodes

    def render(self, *, since_iso: str | None = None, limit: int = 100) -> list[NarrativeEntry]:
        return [
            render_episode(item)
            for item in self._episodes.list_episodes(since_iso=since_iso, limit=limit)
        ]
