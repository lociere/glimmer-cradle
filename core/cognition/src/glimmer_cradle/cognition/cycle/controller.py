"""持续认知循环的阶段编排控制器。"""
from __future__ import annotations

import asyncio
from typing import Callable, Sequence

from glimmer_cradle.cognition.activity import CognitiveActivityController
from glimmer_cradle.cognition.cycle.action_emitter import ActionEmitter
from glimmer_cradle.cognition.cycle.appraisal import PerceptionAppraiser
from glimmer_cradle.cognition.cycle.continuity import CycleContinuity
from glimmer_cradle.cognition.cycle.deliberation import DeliberationController
from glimmer_cradle.cognition.cycle.providers import Provider
from glimmer_cradle.cognition.cycle.reply_context import ReplyContextBuilder
from glimmer_cradle.cognition.cycle.turn import CycleTurn
from glimmer_cradle.cognition.inference.service import ReasoningService
from glimmer_cradle.cognition.cycle.volition import (
    ArbitrationResult,
    Intent,
    WillingnessConfig,
    WillingnessInputs,
    arbitrate,
    compute_willingness,
    make_intent,
    threshold_for,
)
from glimmer_cradle.cognition.cycle.workspace import GlobalWorkspace, WorkspaceItem
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter, gauge
from glimmer_cradle.cognition.observability.tracer import span
from glimmer_cradle.cognition.observability.trace_context import TraceContext, new_trace_id
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.context.sources.episodic_source import RecentExperienceSource

logger = get_logger("cycle_controller")

class CycleController:
    """只负责编排 Sense 到 Consolidate 的阶段顺序与故障隔离。"""

    def __init__(
        self,
        *,
        workspace: GlobalWorkspace,
        providers: Sequence[Provider],
        experience_recorder: ExperienceRecorder,
        activity_controller: CognitiveActivityController | None = None,
        emotion_system=None,  # 提供 emotion_intensity 入 willingness
        willingness_config: WillingnessConfig | None = None,
        default_tick_interval_ms: int = 5000,
        action_sink=None,
        reasoning: ReasoningService | None = None,
        persona_injector=None,
        boundary_validator: "Callable[[str], bool] | None" = None,
        self_entity=None,
        conversation=None,
        multimodal_router=None,
    ) -> None:
        self._ws = workspace
        self._providers: list[Provider] = list(providers)
        recent_experience_source = RecentExperienceSource(experience_recorder)
        self._activity = activity_controller
        self._emotion = emotion_system
        self._willingness_cfg = willingness_config or WillingnessConfig()
        self._default_interval_s: float = max(0.5, default_tick_interval_ms / 1000.0)
        # Act 阶段出口：Callable[[dict], Awaitable] —— 一般 = outbound_adapter.
        # send_action_command。None 时 Act 只记 metric 不推送（蓝图 §4.7 沉默默认）。
        self._action_emitter = ActionEmitter(sink=action_sink, emotion_system=emotion_system)
        reply_context = ReplyContextBuilder(
            self_entity=self_entity,
            conversation=conversation,
            recent_experience_source=recent_experience_source,
        )
        self._appraiser = PerceptionAppraiser(
            recorder=experience_recorder,
            emotion_system=emotion_system,
            multimodal_router=multimodal_router,
            self_entity=self_entity,
        )
        self._deliberation = DeliberationController(
            reasoning=reasoning,
            context_builder=reply_context,
            activity_controller=activity_controller,
            emotion_system=emotion_system,
            persona_injector=persona_injector,
            boundary_validator=boundary_validator,
        )
        self._continuity = CycleContinuity(
            recorder=experience_recorder,
        )
        self._task: asyncio.Task | None = None
        self._running: bool = False
        self._tick_requested = asyncio.Event()
        self._cycle_count: int = 0
        self._last_arbitration: ArbitrationResult | None = None
        self._turn = CycleTurn()

    # ── 启停 ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            logger.warning("认知循环已在运行")
            return
        self._running = True
        self._task = asyncio.create_task(self._main_loop())
        logger.info(
            "认知循环已启动",
            providers=[p.name for p in self._providers],
            workspace_capacity=self._ws.capacity,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("认知循环已停止", total_cycles=self._cycle_count)

    @property
    def cycle_count(self) -> int:
        return self._cycle_count

    def notify_external_input(self) -> None:
        """通知认知循环有外部输入到达，应跳过当前睡眠并尽快跑下一拍。"""
        self._tick_requested.set()

    # ── 循环本体 ──────────────────────────────────────────────────────────

    async def _main_loop(self) -> None:
        while self._running:
            try:
                interval = self._current_tick_interval_s()
                try:
                    await asyncio.wait_for(self._tick_requested.wait(), timeout=interval)
                except asyncio.TimeoutError:
                    pass
                self._tick_requested.clear()
                await self.tick_once()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("认知循环 tick 异常", error=str(e), exc_info=True)

    def _current_tick_interval_s(self) -> float:
        if self._activity is not None:
            try:
                state = self._activity.get_state()
                hint = state.get("policy", {}).get("frequency_hint_ms")
                if isinstance(hint, (int, float)) and hint > 0:
                    return float(hint) / 1000.0
            except Exception:
                pass
        return self._default_interval_s

    # ── 单拍：九阶段编排 ──────────────────────────────────────────────────

    async def tick_once(self) -> None:
        """跑一拍（外部可直调，便于测试与离线重放）。"""
        self._cycle_count += 1
        # 每拍开新 trace + 根 span
        with TraceContext(new_trace_id()):
            with span("cognitive_cycle", attributes={"cycle": self._cycle_count}) as cycle:
                broadcast_item = await self._do_tick()
                if broadcast_item is not None:
                    cycle.set_attribute("broadcast_source", broadcast_item.source)
                    cycle.set_attribute("broadcast_salience", float(broadcast_item.salience))

    async def _do_tick(self) -> WorkspaceItem | None:
        self._turn = CycleTurn()
        # ── Sense / Appraise / Recall（并发投放）──────────────────────────
        snapshot: list[WorkspaceItem] = []
        with span("sense_appraise_recall"):
            snapshot = await self._ws.snapshot()
            results = await asyncio.gather(
                *(self._safe_propose(p, snapshot) for p in self._providers),
                return_exceptions=False,  # _safe_propose 内部已 try
            )

        # Appraise 在竞争前更新情绪，让 Deliberate 消费本次感知后的状态。
        with span("appraise") as s_appraise:
            await self._appraiser.appraise(results, self._turn)
            s_appraise.set_attribute("perceptions", len(self._turn.perception_moment_ids))

        # ── Compete（投候选 → 工作区按 salience 竞争）─────────────────────
        proposed_total = 0
        accepted_total = 0
        with span("compete") as s_compete:
            for items in results:
                for item in items:
                    proposed_total += 1
                    if await self._ws.propose(item):
                        accepted_total += 1
            s_compete.set_attribute("proposed", proposed_total)
            s_compete.set_attribute("accepted", accepted_total)
            counter("cognition.propose", proposed_total, labels={"phase": "compete"})
            counter("cognition.accepted", accepted_total, labels={"phase": "compete"})

        # ── Broadcast（取 top 作"意识内容"）──────────────────────────────
        broadcast_item: WorkspaceItem | None = None
        with span("broadcast") as s_bc:
            broadcast_item = await self._ws.broadcast()
            s_bc.set_attribute("has_content", broadcast_item is not None)

        # Deliberate：结构化规划后生成角色回复或能力请求。
        with span("deliberate") as s_delib:
            self._turn.skill_request = None
            self._turn.action_plan = None
            self._turn.reply = await self._deliberation.deliberate(
                broadcast_item, self._turn
            )
            s_delib.set_attribute("generated_reply", self._turn.reply is not None)
            s_delib.set_attribute("requested_skill", self._turn.skill_request is not None)
            s_delib.set_attribute(
                "action_plan",
                self._turn.action_plan.action if self._turn.action_plan is not None else "",
            )

        # ── Intend（5.7 Volition 连续意愿 + 仲裁）─────────────────────────
        with span("intend") as s_intend:
            intents = self._build_intents(broadcast_item, await self._ws.snapshot())
            activity_state, allows_proactive = self._read_activity_for_volition()
            threshold = threshold_for(activity_state, self._willingness_cfg)
            self._last_arbitration = arbitrate(
                intents, threshold=threshold, allows_proactive=allows_proactive,
            )
            self._turn.arbitration = self._last_arbitration
            s_intend.set_attribute("candidate_intents", len(intents))
            s_intend.set_attribute("accepted_intents", len(self._last_arbitration.accepted))
            s_intend.set_attribute("threshold", threshold)
            counter("cognition.intents_proposed", len(intents))
            counter("cognition.intents_accepted", len(self._last_arbitration.accepted))

        # Act：只发送通过仲裁的 ActionCommand。
        with span("act") as s_act:
            emitted = await self._action_emitter.emit(self._turn.arbitration)
            s_act.set_attribute("actions_emitted", emitted)
            if emitted:
                if self._activity is not None and hasattr(self._activity, "record_self_activity"):
                    self._activity.record_self_activity("action_emitted")
                counter("cognition.actions_emitted", emitted)

        # ── Consolidate（只提交本拍真实经历；后台维护由独立 Scheduler 推进）
        with span("consolidate") as s_cons:
            await self._continuity.commit(self._turn)
            s_cons.set_attribute("experience_committed", True)

        await self._consume_ephemeral_broadcast(broadcast_item)
        gauge("cognition.tick_alive", 1.0)
        gauge("cognition.workspace_size", float(await self._ws.size()))
        return broadcast_item

    # ── 内部辅助 ─────────────────────────────────────────────────────────

    async def _consume_ephemeral_broadcast(self, broadcast_item: WorkspaceItem | None) -> None:
        """消费事件型广播，避免同一外部输入在后续 tick 被重复处理。"""
        if broadcast_item is None or broadcast_item.source != "perception":
            return
        content = broadcast_item.content if isinstance(broadcast_item.content, dict) else {}
        if not content.get("scene_id") or not content.get("trace_id"):
            return
        if await self._ws.remove(broadcast_item.item_id):
            counter("cognition.workspace_consumed", 1, labels={"source": "perception"})

    async def _safe_propose(
        self, provider: Provider, snapshot: list[WorkspaceItem]
    ) -> list[WorkspaceItem]:
        """Provider 异常隔离：单个崩不影响他人。"""
        try:
            return await provider.propose(snapshot)
        except Exception as e:
            logger.error(
                "Provider propose 异常",
                provider=provider.name,
                error=str(e),
                exc_info=True,
            )
            counter("cognition.provider_error", 1, labels={"provider": provider.name})
            return []

    @property
    def last_arbitration(self) -> ArbitrationResult | None:
        """检视最近一拍的仲裁结果（5.9 切流时 ActionStream 从此取）。"""
        return self._last_arbitration

    def _build_intents(
        self,
        broadcast_item: WorkspaceItem | None,
        snapshot: list[WorkspaceItem],
    ) -> list[Intent]:
        """为本拍构建候选 Intent。

        当前规则（5.7 起步版，待 5.9 切流前再细化）：
        - 无 broadcast → 不生意图（沉默靠 reply 缺失体现，不显式产 silence intent）
        - broadcast.source == perception → reply intent（payload 含 perception text）
        - 其他 source（drive/affect/memory/social）→ thought intent
        - drive(companionship) 特殊：如其 level 很高，升级为 reply intent
        """
        if broadcast_item is None:
            return []

        inputs = self._gather_willingness_inputs(broadcast_item, snapshot)
        w = compute_willingness(inputs, self._willingness_cfg)

        bc = broadcast_item.content if isinstance(broadcast_item.content, dict) else {}
        if broadcast_item.source == "perception":
            initiative = "reactive" if bc.get("address_mode") == "direct" else "proactive"
            if self._turn.skill_request is not None:
                return [make_intent(
                    type="action",
                    initiative=initiative,
                    willingness=w,
                    payload={
                        "action_type": "skill_request",
                        "scene_id": bc.get("scene_id", ""),
                        "conversation_id": bc.get("conversation_id", ""),
                        "continuity_id": bc.get("continuity_id", ""),
                        "thread_id": bc.get("thread_id", "main"),
                        "recall_scope": bc.get("recall_scope", "conversation_private"),
                        "disclosure_scope": bc.get("disclosure_scope", "conversation_private"),
                        "actor_id": bc.get("actor_id"),
                        "actor_name": bc.get("actor_name"),
                        "trace_id": bc.get("trace_id", ""),
                        "original_goal": self._turn.skill_request.get("original_goal", ""),
                        "reason": self._turn.skill_request.get("reason"),
                        "capability_kind": self._turn.skill_request.get("capability_kind"),
                        "confidence": self._turn.skill_request.get("confidence"),
                        "planning_hint": self._turn.skill_request.get("planning_hint"),
                    },
                )]
            # 无生成、越界或推理失败时不产生 reply intent。
            if not self._turn.reply:
                return []
            return [make_intent(
                type="reply",
                initiative=initiative,
                willingness=w,
                payload={
                    "text": self._turn.reply,
                    "scene_id": bc.get("scene_id", ""),
                    "actor_id": bc.get("actor_id"),
                    "actor_name": bc.get("actor_name"),
                    # trace_id 带进 intent payload —— Act 构造 ActionCommand 时关联回原 perception
                    "trace_id": bc.get("trace_id", ""),
                },
            )]
        if broadcast_item.source == "drive" and bc.get("drive") == "companionship":
            # 强陪伴欲：proactive reply（仍受 activity policy 闸控）。
            return [make_intent(
                type="reply",
                initiative="proactive",
                willingness=w,
                payload={"trigger": "drive.companionship", "level": bc.get("level", 0.0)},
            )]
        # 其他来源 → 主动思考
        return [make_intent(
            type="thought",
            initiative="proactive",
            willingness=w,
            payload={"source": broadcast_item.source, "content": bc},
        )]

    def _gather_willingness_inputs(
        self,
        broadcast_item: WorkspaceItem,
        snapshot: list[WorkspaceItem],
    ) -> WillingnessInputs:
        """从工作区快照 + 周边子系统抽取意愿公式输入。"""
        bc = broadcast_item.content if isinstance(broadcast_item.content, dict) else {}
        # address_mode：当且仅当 broadcast 是 perception 时有效
        addr = bc.get("address_mode", "") if broadcast_item.source == "perception" else ""

        # emotion_intensity：从 EmotionSystem 读
        emotion_intensity = 0.0
        if self._emotion is not None:
            try:
                emotion_intensity = float(self._emotion.get_state().get("intensity", 0.0))
            except Exception:
                pass

        # intimacy：扫 snapshot 找 social 项
        intimacy = 0.0
        for it in snapshot:
            if it.source == "social" and isinstance(it.content, dict):
                v = it.content.get("familiarity")
                if isinstance(v, (int, float)):
                    intimacy = float(v)
                    break

        # drive_companionship：扫 snapshot 找 drive 项的 all_levels
        drive_comp = 0.0
        for it in snapshot:
            if it.source == "drive" and isinstance(it.content, dict):
                all_levels = it.content.get("all_levels", {})
                if isinstance(all_levels, dict):
                    v = all_levels.get("companionship", 0.0)
                    if isinstance(v, (int, float)):
                        drive_comp = float(v)
                        break

        # silence_seconds：用认知活动 idle_seconds 作近似（精确版需独立 tracker）。
        silence_seconds = 0.0
        if self._activity is not None:
            try:
                silence_seconds = float(self._activity.get_state().get("idle_seconds", 0.0))
            except Exception:
                pass

        return WillingnessInputs(
            address_mode=addr,
            emotion_intensity=emotion_intensity,
            relationship_intimacy=intimacy,
            drive_companionship=drive_comp,
            silence_seconds=silence_seconds,
        )

    def _read_activity_for_volition(self) -> tuple[str, bool]:
        """读认知活动态与 allows_proactive 策略。"""
        if self._activity is None:
            return ("engaged", True)
        try:
            state = self._activity.get_state()
            activity_state = str(state.get("state", "engaged"))
            allows = bool(state.get("policy", {}).get("allows_proactive", True))
            return (activity_state, allows)
        except Exception:
            return ("engaged", True)
