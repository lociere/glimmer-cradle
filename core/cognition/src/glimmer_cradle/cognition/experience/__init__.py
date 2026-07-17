"""
经历层（Experience）—— Glimmer Cradle 架构蓝图 §4.1 / §1.3 脊柱①。

经历之流（Moment 流）是 Glimmer Cradle 架构的脊柱①：一条不可变、append-only 的真相记录。
当前角色经历的一切都作为 Moment 追加进去；状态是它的投影；Moment 之间通过
``causation_ids`` 编织因果网（蓝图 §4.1）。

Ledger 保存不可变 Moment；Episode 是可删除、可从 Ledger 重建的派生投影。
Trace 位于 telemetry，不作为 Experience 的生命周期边界。

详见 docs/architecture/blueprint/微光摇篮架构蓝图.md §4.1。
"""
from glimmer_cradle.cognition.experience.events import AffectSnapshot, Moment, MomentKind, SourceDescriptor
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.experience.episodes import Episode, EpisodeProjection
from glimmer_cradle.cognition.experience.narrative import NarrativeEntry, NarrativeJournal, render_episode

__all__ = ["AffectSnapshot", "Moment", "MomentKind", "SourceDescriptor",
           "ExperienceRecorder", "Episode", "EpisodeProjection",
           "NarrativeEntry", "NarrativeJournal", "render_episode"]
