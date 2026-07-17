"""从持久 Episode 投影生成零 token、可溯源的第一人称时间线。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from glimmer_cradle.cognition.experience.episodes import Episode, EpisodeProjection


@dataclass(frozen=True)
class NarrativeEntry:
    episode_id: str
    occurred_at: str
    text: str
    episode_size: int
    moment_ids: tuple[str, ...]


def _time(value: str) -> str:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%H:%M")
    except ValueError:
        return "??:??"


def render_episode(episode: Episode) -> NarrativeEntry:
    snippets: list[str] = []
    for moment in episode.moments:
        content = moment.content if isinstance(moment.content, dict) else {}
        text = str(content.get("text") or "").strip()
        if moment.kind == "perception" and text:
            speaker = moment.actor_name or moment.actor_id or "你"
            snippets.append(f'{speaker}说“{text}”')
        elif moment.kind == "reply" and text:
            snippets.append(f'我回答“{text}”')
        elif moment.kind == "action_result":
            snippets.append("我收到了外部能力的结果")
        elif moment.kind == "silence":
            snippets.append("我选择先不说话")
    body = "。".join(snippets) if snippets else "我经历了一段安静的时刻"
    return NarrativeEntry(episode.episode_id, episode.started_at,
                          f"{_time(episode.started_at)} {body}。", len(episode.moments),
                          tuple(item.moment_id for item in episode.moments))


class NarrativeJournal:
    def __init__(self, episodes: EpisodeProjection) -> None:
        self._episodes = episodes

    def render(self, *, since_iso: str | None = None, limit: int = 100) -> list[NarrativeEntry]:
        return [render_episode(item) for item in self._episodes.list_episodes(
            since_iso=since_iso, limit=limit)]
