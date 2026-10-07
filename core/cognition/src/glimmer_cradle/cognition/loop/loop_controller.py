"""持续认知循环的阶段编排控制器。"""
from __future__ import annotations

import asyncio
import json
from contextlib import aclosing
from typing import Awaitable, Callable, Sequence

from glimmer_cradle.cognition.attention import (
    Attention,
    AttentionController,
    make_attention,
)
from glimmer_cradle.cognition.context import RecentExperienceSource
from glimmer_cradle.cognition.inference import (
    InferenceController,
    InferenceRequest,
    InferenceStep,
    InferenceUnavailable,
    ModelEventKind,
    ModelTier,
    ModelToolCall,
    RealtimeModelPort,
)
from glimmer_cradle.cognition.loop.checkpoint import LoopCheckpoint, LoopCheckpointStore
from glimmer_cradle.cognition.loop.recovery import recover_checkpoint
from glimmer_cradle.cognition.loop.run import ActionEmitter, CycleContinuity, LoopRun
from glimmer_cradle.cognition.loop.step import (
    ArbitrationResult,
    DeliberationController,
    Intent,
    LoopStep,
    PerceptionAppraiser,
    Provider,
    WillingnessConfig,
    WillingnessInputs,
    arbitrate,
    compute_willingness,
    make_intent,
    threshold_for,
)
from glimmer_cradle.cognition.loop.stop_policy import StopPolicy
from glimmer_cradle.cognition.perception import (
    Observation,
    ObservationQueue,
    PerceptionOperationRegistry,
)
from glimmer_cradle.cognition.planning import PlanningController
from glimmer_cradle.cognition.ports import IdGeneratorPort, ObservabilityPort
from glimmer_cradle.cognition.ports.capability_port import (
    LOAD_SKILL,
    READ_RESOURCE,
    CapabilityInvocation,
    CapabilityPort,
    CapabilityResult,
)
from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.state import CognitiveActivityController
from glimmer_cradle.conversation import ConversationRecorder, TurnController
from pydantic import BaseModel, ConfigDict, Field


class CognitionSettings(BaseModel):
    """Loop composition 所需的容量与兜底节拍配置。"""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    workspace_capacity: int = Field(ge=1)
    default_tick_interval_ms: int = Field(ge=1)


def salience_for_perception(*, address_mode: str, familiarity: int) -> float:
    """将明确呼叫固定为最高显著度，其余感知按熟悉度有限提升。"""
    if address_mode == "direct":
        return 1.0
    bonus = max(0, min(10, int(familiarity))) / 10.0 * 0.3
    return max(0.1, min(1.0, 0.4 + bonus))


class PerceptionProvider(Provider):
    """在 Loop Sense 阶段 drain Observation，并生成 Attention 候选。"""

    name = "perception"

    def __init__(
        self,
        queue: ObservationQueue,
        *,
        max_items_per_tick: int = 5,
        clock: ClockPort,
        ids: IdGeneratorPort,
    ) -> None:
        self._queue = queue
        self._max_items = max(1, int(max_items_per_tick))
        self._clock = clock
        self._ids = ids

    async def propose(self, workspace_snapshot: list[Attention]) -> list[Attention]:
        entries: list[Observation] = self._queue.drain(max_items=self._max_items)
        items: list[Attention] = []
        for entry in entries:
            content = {
                "text": entry.text,
                "scene_id": entry.scene_id,
                "conversation_id": entry.conversation_id,
                "continuity_id": entry.continuity_id,
                "thread_id": entry.thread_id,
                "recall_scope": entry.recall_scope,
                "disclosure_scope": entry.disclosure_scope,
                "address_mode": entry.address_mode,
                "response_policy": entry.response_policy,
                "familiarity": entry.familiarity,
                "trace_id": entry.trace_id,
                "origin": entry.origin,
                "retention_ceiling": entry.retention_ceiling,
                "interaction_id": entry.interaction_id,
                "payload_digest": entry.payload_digest,
                "source_provider_id": entry.source_provider_id,
            }
            if entry.actor_id:
                content["actor_id"] = entry.actor_id
            if entry.actor_name:
                content["actor_name"] = entry.actor_name
            if entry.model_input is not None:
                content["model_input"] = entry.model_input
            items.append(
                make_attention(
                    source=self.name,
                    content=content,
                    salience=salience_for_perception(
                        address_mode=entry.address_mode,
                        familiarity=entry.familiarity,
                    ),
                    clock=self._clock,
                    ids=self._ids,
                )
            )
        return items

class LoopController:
    """只负责编排 Sense 到 Consolidate 的阶段顺序与故障隔离。"""

    def __init__(
        self,
        *,
        workspace: AttentionController,
        providers: Sequence[Provider],
        experience_recorder: ConversationRecorder,
        activity_controller: CognitiveActivityController | None = None,
        emotion_system=None,  # 提供 emotion_intensity 入 willingness
        willingness_config: WillingnessConfig | None = None,
        default_tick_interval_ms: int = 5000,
        action_sink=None,
        reasoning: InferenceController | None = None,
        planning_controller: PlanningController | None = None,
        native_model: RealtimeModelPort | None = None,
        capability_factory: Callable[[dict], CapabilityPort] | None = None,
        checkpoint_store: LoopCheckpointStore | None = None,
        persona_compiler=None,
        boundary_validator: "Callable[[str], bool] | None" = None,
        memory=None,
        knowledge_base=None,
        conversation=None,
        multimodal_router=None,
        multimodal_core_model: str = "",
        perception_operations: PerceptionOperationRegistry | None = None,
        turn_controller: TurnController | None = None,
        clock: ClockPort,
        ids: IdGeneratorPort,
        observability: ObservabilityPort,
    ) -> None:
        self._clock = clock
        if (native_model is None) != (capability_factory is None):
            raise ValueError("native model and capability factory must be paired")
        self._native_model = native_model
        self._capability_factory = capability_factory
        self._ids = ids
        self._observability = observability
        self.logger = observability.logger("loop_controller")
        self._ws = workspace
        self._providers: list[Provider] = list(providers)
        recent_experience_source = RecentExperienceSource(experience_recorder)
        self._activity = activity_controller
        self._emotion = emotion_system
        self._willingness_cfg = willingness_config or WillingnessConfig()
        self._default_interval_s: float = max(0.5, default_tick_interval_ms / 1000.0)
        # Act 阶段出口：Callable[[dict], Awaitable]，由 Worker 注入 KernelEventPort。
        # send_action_command。None 时 Act 只记 metric 不推送（蓝图 §4.7 沉默默认）。
        self._action_emitter = ActionEmitter(
            sink=action_sink, emotion_system=emotion_system, observability=observability
        )
        self._appraiser = PerceptionAppraiser(
            recorder=experience_recorder,
            emotion_system=emotion_system,
            multimodal_router=multimodal_router,
            multimodal_core_model=multimodal_core_model,
            observability=observability,
        )
        self._deliberation = DeliberationController(
            reasoning=reasoning,
            native_inference=self._deliberate_native if native_model is not None else None,
            planning_controller=planning_controller,
            memory=memory,
            knowledge_base=knowledge_base,
            conversation=conversation,
            recent_experience_source=recent_experience_source,
            activity_controller=activity_controller,
            emotion_system=emotion_system,
            persona_compiler=persona_compiler,
            boundary_validator=boundary_validator,
            observability=observability,
        )
        self._continuity = CycleContinuity(
            recorder=experience_recorder,
        )
        self._task: asyncio.Task | None = None
        self._running: bool = False
        self._tick_requested = asyncio.Event()
        self._cycle_count: int = 0
        self._last_arbitration: ArbitrationResult | None = None
        self._turn = LoopStep()
        self._checkpoint_store = checkpoint_store
        self._checkpoint_revision = 0
        self._perception_operations = perception_operations
        self._turn_controller = turn_controller
        self._active_perception_trace = ""
        self._cycle_perception_traces: set[str] = set()

    # ── 启停 ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._running:
            self.logger.warning("认知循环已在运行")
            return
        if self._checkpoint_store is not None:
            checkpoint = await self._checkpoint_store.load("main")
            if checkpoint is not None:
                recovered = recover_checkpoint(checkpoint)
                self._cycle_count = recovered.cycle_count
                self._checkpoint_revision = recovered.revision
                if recovered.status != checkpoint.status:
                    saved = await self._checkpoint_store.save(
                        recovered,
                        expected_revision=self._checkpoint_revision,
                    )
                    self._checkpoint_revision = saved.revision
        self._running = True
        await self._persist_checkpoint("running")
        self._task = asyncio.create_task(self._main_loop())
        self.logger.info(
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
        await self._persist_checkpoint("stopped")
        self.logger.info("认知循环已停止", total_cycles=self._cycle_count)

    @property
    def cycle_count(self) -> int:
        return self._cycle_count

    def notify_external_input(self) -> None:
        """通知认知循环有外部输入到达，应跳过当前睡眠并尽快跑下一拍。"""
        self._tick_requested.set()

    async def run_native(
        self,
        request: InferenceRequest,
        *,
        model: RealtimeModelPort,
        capabilities: CapabilityPort,
        scope: str,
        stop_policy: StopPolicy | None = None,
        invocation_allowed: Callable[[], Awaitable[bool]] | None = None,
        inference_allowed: Callable[[], bool] | None = None,
    ) -> LoopRun:
        """Run a bounded native model/tool loop without reclassifying tool calls."""
        policy = stop_policy or StopPolicy()
        # Cancellation must reach the active model socket / RPC, not detach a side effect.
        async with asyncio.timeout(policy.max_duration_seconds):
            return await self._run_native(request, model=model, capabilities=capabilities,
                scope=scope, policy=policy, invocation_allowed=invocation_allowed,
                inference_allowed=inference_allowed)

    async def _run_native(self, request: InferenceRequest, *, model: RealtimeModelPort,
        capabilities: CapabilityPort, scope: str, policy: StopPolicy,
        invocation_allowed: Callable[[], Awaitable[bool]] | None,
        inference_allowed: Callable[[], bool] | None) -> LoopRun:
        run_id = self._ids.new()
        results: list[CapabilityResult] = []
        output_parts: list[str] = []
        history = list(request.history)
        seen_calls: set[str] = set()
        step_count = 0
        capability_calls = 0

        while True:
            if inference_allowed is not None and not inference_allowed():
                return LoopRun(run_id, "stopped", step_count, stop_reason="model_tier_denied",
                    capability_results=tuple(results))
            reason = policy.stop_reason(
                step_count=step_count,
                capability_calls=capability_calls,
                output_chars=sum(len(part) for part in output_parts),
            )
            if reason is not None:
                return LoopRun(
                    run_id=run_id,
                    status="stopped",
                    step_count=step_count,
                    output="".join(output_parts),
                    stop_reason=reason,
                    capability_results=tuple(results),
                )

            step_count += 1
            can_invoke = invocation_allowed is None or await invocation_allowed()
            exposure = await capabilities.expose(scope=scope, run_id=run_id, step=step_count,
                remaining_calls=policy.max_capability_calls - capability_calls if can_invoke else 0)
            exposed = exposure.tools
            if exposure.run_id != run_id or exposure.step != step_count or len({item.name for item in exposed}) != len(exposed) \
                    or any(not item.name or not item.definition_id or not item.definition_revision for item in exposed):
                raise ValueError("invalid capability exposure")
            exposed_by_name = {descriptor.name: descriptor for descriptor in exposed}
            if any(name in exposed_by_name for name in (LOAD_SKILL, READ_RESOURCE)):
                raise ValueError("native loading operation name collision")
            skills_by_id = {item.reference.skill_id: item for item in exposure.skills}
            resources_by_id = {item.definition_id: item for item in exposure.resources}
            if len(skills_by_id) != len(exposure.skills) or len(resources_by_id) != len(exposure.resources):
                raise ValueError("duplicate native catalog references")
            current = InferenceRequest(system=request.system, user=request.user, max_tokens=request.max_tokens,
                temperature=request.temperature, vision=request.vision, provider_key=request.provider_key,
                history=tuple(history),
                metadata={**request.metadata, "run_id": run_id, "step": step_count, "capabilities": tuple(exposed),
                    "skills": exposure.skills, "resources": exposure.resources, "capability_results": tuple(results),
                    "remaining_capability_calls": policy.max_capability_calls - capability_calls if can_invoke else 0})
            step_calls: list[dict[str, object]] = []
            completed = False
            previous_sequence = -1
            step_text: list[str] = []
            if inference_allowed is not None and not inference_allowed():
                return LoopRun(run_id, "stopped", step_count, stop_reason="model_tier_denied",
                    capability_results=tuple(results))
            async with aclosing(model.events(current)) as events:
                async for event in events:
                    if completed or event.sequence <= previous_sequence:
                        raise ValueError("invalid model event order")
                    previous_sequence = event.sequence
                    if event.kind == ModelEventKind.TEXT_DELTA:
                        text = event.payload.get("text")
                        if isinstance(text, str):
                            remaining = policy.max_output_chars - sum(
                                len(part) for part in output_parts
                            )
                            output_parts.append(text[:remaining])
                            step_text.append(text[:remaining])
                            if len(text) > remaining:
                                return LoopRun(
                                    run_id=run_id, status="stopped", step_count=step_count,
                                    output="".join(output_parts), stop_reason="output_limit",
                                    capability_results=tuple(results),
                                )
                    elif event.kind == ModelEventKind.TOOL_CALL:
                        step_calls.append(event.payload)
                        if len(step_calls) > policy.max_capability_calls:
                            return LoopRun(run_id, "stopped", step_count, stop_reason="capability_call_limit",
                                capability_results=tuple(results))
                    elif event.kind == ModelEventKind.FAILED:
                        return LoopRun(
                            run_id=run_id, status="failed", step_count=step_count,
                            output="".join(output_parts),
                            stop_reason=str(event.payload.get("error") or "model_failed"),
                            capability_results=tuple(results),
                        )
                    elif event.kind == ModelEventKind.COMPLETED:
                        completed = True

            if not completed:
                return LoopRun(run_id=run_id, status="failed", step_count=step_count, output="".join(output_parts),
                    stop_reason="model_stream_incomplete", capability_results=tuple(results))
            if not step_calls:
                return LoopRun(
                    run_id=run_id,
                    status="completed" if completed else "failed",
                    step_count=step_count,
                    output="".join(step_text),
                    stop_reason="" if completed else "model_stream_incomplete",
                    capability_results=tuple(results),
                )

            # Validate the entire batch before the first side effect, including call identity.
            calls: list[ModelToolCall] = []
            invocations: list[CapabilityInvocation] = []
            batch_ids: set[str] = set()
            for payload in step_calls:
                if capability_calls >= policy.max_capability_calls:
                    return LoopRun(
                        run_id=run_id,
                        status="stopped",
                        step_count=step_count,
                        output="".join(output_parts),
                        stop_reason="capability_call_limit",
                        capability_results=tuple(results),
                    )
                call_id = payload.get("call_id")
                name = payload.get("name")
                arguments = payload.get("arguments", {})
                if not isinstance(call_id, str) or not call_id or not isinstance(name, str) or not name:
                    return LoopRun(
                        run_id=run_id,
                        status="failed",
                        step_count=step_count,
                        output="".join(output_parts),
                        stop_reason="invalid_tool_call",
                        capability_results=tuple(results),
                    )
                if not isinstance(arguments, dict):
                    return LoopRun(
                        run_id=run_id,
                        status="failed",
                        step_count=step_count,
                        output="".join(output_parts),
                        stop_reason="invalid_tool_arguments",
                        capability_results=tuple(results),
                    )
                try:
                    encoded = json.dumps(arguments, ensure_ascii=False, allow_nan=False)
                    valid = len(encoded.encode("utf-8")) <= 64 * 1024 and all(
                        len(value.encode("utf-8")) <= 4096 for value in (call_id, name))
                    arguments = json.loads(encoded)
                except (ValueError, TypeError, RecursionError):
                    valid = False
                if not valid:
                    return LoopRun(run_id, "failed", step_count, stop_reason="invalid_tool_arguments",
                        capability_results=tuple(results))
                kind = payload.get("kind", "tool")
                definition_id = definition_revision = ""
                reader_arguments = arguments
                if kind == "tool" and name in exposed_by_name:
                    definition_id = exposed_by_name[name].definition_id
                    definition_revision = exposed_by_name[name].definition_revision
                elif kind in {"skill", "resource"} and name == (LOAD_SKILL if kind == "skill" else READ_RESOURCE):
                    selected = arguments.get("skill_id" if kind == "skill" else "resource_id")
                    reader_arguments = arguments.get("arguments", {})
                    if not isinstance(selected, str) or not isinstance(reader_arguments, dict):
                        return LoopRun(run_id, "failed", step_count, stop_reason="invalid_tool_arguments", capability_results=tuple(results))
                    if kind == "skill" and selected in skills_by_id:
                        definition_id = selected
                        definition_revision = skills_by_id[selected].reference.definition_revision
                    if kind == "resource" and selected in resources_by_id:
                        definition_id = selected
                        definition_revision = resources_by_id[selected].definition_revision
                if not definition_id or not definition_revision:
                    return LoopRun(
                        run_id=run_id,
                        status="failed",
                        step_count=step_count,
                        output="".join(output_parts),
                        stop_reason="capability_not_exposed",
                        capability_results=tuple(results),
                    )
                if call_id in seen_calls or call_id in batch_ids:
                    return LoopRun(run_id, "failed", step_count, stop_reason="duplicate_tool_call",
                        capability_results=tuple(results))
                batch_ids.add(call_id)
                calls.append(ModelToolCall(call_id, name, arguments))
                invocations.append(CapabilityInvocation(run_id, step_count, call_id, name, reader_arguments,
                    f"{run_id}:{call_id}", definition_id, definition_revision, kind))
            step_results: list[CapabilityResult] = []
            if len(calls) > policy.max_capability_calls - capability_calls:
                return LoopRun(run_id, "stopped", step_count, stop_reason="capability_call_limit",
                    capability_results=tuple(results))
            for call, invocation in zip(calls, invocations, strict=True):
                if invocation_allowed is not None and not await invocation_allowed():
                    return LoopRun(run_id, "stopped", step_count, stop_reason="volition_denied",
                        capability_results=tuple(results))
                if capability_calls >= policy.max_capability_calls:
                    return LoopRun(run_id, "stopped", step_count, stop_reason="capability_call_limit",
                        capability_results=tuple(results))
                call_id, name, arguments = call.call_id, call.name, call.arguments
                capability_calls += 1
                result = await capabilities.invoke(invocation)
                if result.call_id != call_id or result.name != name or result.status not in {"succeeded", "failed", "unknown"}:
                    raise ValueError("invalid capability result identity")
                results.append(result)
                step_results.append(result)
                seen_calls.add(call_id)
                if result.status == "unknown":
                    return LoopRun(run_id, "failed", step_count, stop_reason="recovery_required",
                        capability_results=tuple(results))
            history.append(InferenceStep("".join(step_text), tuple(calls), tuple(step_results)))

    async def _deliberate_native(self, request: InferenceRequest, content: dict,
        tier: ModelTier) -> str | None:
        if tier != ModelTier.CLOUD_ALLOWED:
            # No local native streaming backend is configured; never promote a local-only request.
            raise InferenceUnavailable("native model tier is unavailable")
        assert self._native_model is not None and self._capability_factory is not None
        run = await self.run_native(request, model=self._native_model,
            capabilities=self._capability_factory(content), scope=content["conversation_id"],
            invocation_allowed=lambda: self._native_invocation_allowed(content),
            inference_allowed=lambda: self._deliberation.reasoning_tier() == ModelTier.CLOUD_ALLOWED)
        if run.status != "completed":
            raise RuntimeError(f"native inference did not complete: {run.stop_reason}")
        self._turn.native_result_fact_ids = [item.result_fact_id for item in run.capability_results if item.result_fact_id]
        return run.output

    async def _native_invocation_allowed(self, content: dict) -> bool:
        if content.get("response_policy") == "observe_only":
            return False
        if self._deliberation.reasoning_tier() != ModelTier.CLOUD_ALLOWED:
            return False
        if content.get("address_mode") == "direct":
            return True
        activity, proactive = self._read_activity_for_volition()
        if not proactive or self._turn.broadcast is None:
            return False
        willingness = compute_willingness(self._gather_willingness_inputs(
            self._turn.broadcast, await self._ws.snapshot()), self._willingness_cfg)
        return willingness >= threshold_for(activity, self._willingness_cfg)

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
                tick_task = asyncio.create_task(self.tick_once())
                try:
                    await tick_task
                except asyncio.CancelledError:
                    if not self._running:
                        tick_task.cancel()
                        raise
                    # 单个感知被取消只终止当前 tick，循环继续服务后续输入。
                    continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error("认知循环 tick 异常", error=str(e), exc_info=True)

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
        self._active_perception_trace = ""
        self._cycle_perception_traces.clear()
        try:
            # 每拍开新 trace + 根 span
            with self._observability.trace_context(self._observability.new_trace_id()):
                with self._observability.span(
                    "cognitive_cycle", attributes={"cycle": self._cycle_count}
                ) as cycle:
                    broadcast_item = await self._do_tick()
                    if broadcast_item is not None:
                        cycle.set_attribute("broadcast_source", broadcast_item.source)
                        cycle.set_attribute("broadcast_salience", float(broadcast_item.salience))
                        trace_id = self._perception_trace(broadcast_item)
                        if trace_id and self._perception_operations is not None:
                            self._perception_operations.finish(trace_id, "succeeded")
                    await self._persist_checkpoint("completed")
        except asyncio.CancelledError:
            await self._finish_active_turn("interrupted", "cycle_cancelled")
            if self._active_perception_trace and self._perception_operations is not None:
                self._perception_operations.finish(self._active_perception_trace, "cancelled", "感知操作已取消")
            await self._persist_checkpoint("interrupted")
            raise
        except Exception:
            await self._finish_active_turn("failed", "cycle_failed")
            if self._perception_operations is not None:
                for trace_id in self._cycle_perception_traces:
                    self._perception_operations.finish(trace_id, "failed", "认知循环处理失败")
            await self._persist_checkpoint("failed")
            raise
        finally:
            self._active_perception_trace = ""
            self._cycle_perception_traces.clear()

    async def _do_tick(self) -> Attention | None:
        self._turn = LoopStep()
        # ── Sense / Appraise / Recall（并发投放）──────────────────────────
        snapshot: list[Attention] = []
        with self._observability.span("sense_appraise_recall"):
            snapshot = await self._ws.snapshot()
            results = await asyncio.gather(
                *(self._safe_propose(p, snapshot) for p in self._providers),
                return_exceptions=False,  # _safe_propose 内部已 try
            )

        # Appraise 在竞争前更新情绪，让 Deliberate 消费本次感知后的状态。
        with self._observability.span("appraise") as s_appraise:
            self._cycle_perception_traces.update(
                trace_id
                for items in results
                for item in items
                if (trace_id := self._perception_trace(item))
            )
            await self._appraiser.appraise(results, self._turn)
            s_appraise.set_attribute("perceptions", len(self._turn.perception_moment_ids))

        # ── Compete（投候选 → 工作区按 salience 竞争）─────────────────────
        proposed_total = 0
        accepted_total = 0
        with self._observability.span("compete") as s_compete:
            for items in results:
                for item in items:
                    proposed_total += 1
                    accepted, evicted = await self._ws.propose_with_eviction(item)
                    if accepted:
                        accepted_total += 1
                    elif item.source == "perception":
                        self._finish_unbroadcast_perception(item, "not_selected")
                    if evicted is not None and evicted.source == "perception" and self._perception_operations is not None:
                        self._finish_unbroadcast_perception(evicted, "superseded")
            # ambient 表示背景观察，不承诺进入意识广播或产生行动。Appraise 已经把它
            # 写入经历主线，因此无论候选暂存、落选或被替换，入站操作都已经成功。
            for items in results:
                for item in items:
                    if self._is_ambient_perception(item):
                        self._finish_perception_success(item, "observed")
            s_compete.set_attribute("proposed", proposed_total)
            s_compete.set_attribute("accepted", accepted_total)
            self._observability.counter("cognition.propose", proposed_total, labels={"phase": "compete"})
            self._observability.counter("cognition.accepted", accepted_total, labels={"phase": "compete"})

        # ── Broadcast（取 top 作"意识内容"）──────────────────────────────
        broadcast_item: Attention | None = None
        with self._observability.span("broadcast") as s_bc:
            broadcast_item = await self._ws.focus()
            s_bc.set_attribute("has_content", broadcast_item is not None)
        trace_id = self._perception_trace(broadcast_item)
        if trace_id:
            active_turn = self._turn.turns_by_trace.get(trace_id)
            if active_turn is None:
                # Workspace 可在当前候选被拒时返回上一拍遗留感知；它没有本拍 Turn，
                # 不能借用其他会话上下文，也不能让已正确失败的当前 ingress 变成 tick 异常。
                self.logger.warning(
                    "忽略缺少本拍 ConversationTurn 的陈旧感知广播",
                    trace_id=trace_id,
                )
                self._observability.counter(
                    "cognition.stale_perception_broadcast", 1
                )
                broadcast_item = None
                trace_id = ""
            else:
                if self._turn_controller is not None:
                    accepted_turn = await self._turn_controller.accept(active_turn)
                    active_turn = await self._turn_controller.start(
                        accepted_turn.turn_id,
                        expected_revision=accepted_turn.revision,
                    )
                self._turn.turn = active_turn
                self._turn.perception_moment_ids = list(
                    self._turn.perception_moment_ids_by_trace.get(trace_id, ())
                )
                self._turn.response_policies = list(
                    self._turn.response_policy_by_trace.get(trace_id, ())
                )
                self._appraiser.record_active_emotion(self._turn)
        else:
            self._turn.perception_moment_ids = []
            self._turn.response_policies = []
        if trace_id and self._perception_operations is not None:
            self._active_perception_trace = trace_id
            operation = self._perception_operations.get_by_trace(trace_id)
            if operation is not None and operation.state == "cancelled":
                if broadcast_item is not None:
                    await self._ws.remove(broadcast_item.attention_id)
                raise asyncio.CancelledError
            task = asyncio.current_task()
            if task is not None:
                self._perception_operations.mark_running(trace_id, task)

        self._turn.broadcast = broadcast_item
        # Deliberate：角色上下文进入原生 Loop；未迁移消费者保留旧规划。
        with self._observability.span("deliberate") as s_delib:
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
        with self._observability.span("intend") as s_intend:
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
            self._observability.counter("cognition.intents_proposed", len(intents))
            self._observability.counter("cognition.intents_accepted", len(self._last_arbitration.accepted))

        # Act：只发送通过仲裁的 ActionCommand。
        with self._observability.span("act") as s_act:
            await self._continuity.record_action(self._turn)
            emitted = await self._action_emitter.emit(self._turn.arbitration, source_fact_id=self._turn.action_moment_id)
            s_act.set_attribute("actions_emitted", emitted)
            if emitted:
                if self._activity is not None and hasattr(self._activity, "record_self_activity"):
                    self._activity.record_self_activity("action_emitted")
                self._observability.counter("cognition.actions_emitted", emitted)

        # ── Consolidate（只提交本拍真实经历；后台维护由独立 Scheduler 推进）
        with self._observability.span("consolidate") as s_cons:
            await self._continuity.commit(self._turn)
            s_cons.set_attribute("experience_committed", True)

        if self._turn.skill_request is None:
            await self._finish_active_turn("completed", None)

        await self._consume_ephemeral_broadcast(broadcast_item)
        self._observability.gauge("cognition.tick_alive", 1.0)
        self._observability.gauge("cognition.workspace_size", float(await self._ws.size()))
        return broadcast_item

    async def _finish_active_turn(self, status: str, reason: str | None) -> None:
        if self._turn_controller is None:
            return
        turn = self._turn.turn
        if not turn.turn_id or turn.revision <= 0 or turn.is_terminal:
            return
        if status == "completed":
            self._turn.turn = await self._turn_controller.complete(
                turn.turn_id, expected_revision=turn.revision
            )
        elif status == "interrupted":
            self._turn.turn = await self._turn_controller.interrupt(
                turn.turn_id,
                expected_revision=turn.revision,
                reason=reason or "interrupted",
            )
        else:
            self._turn.turn = await self._turn_controller.fail(
                turn.turn_id,
                expected_revision=turn.revision,
                reason=reason or "failed",
            )

    # ── 内部辅助 ─────────────────────────────────────────────────────────

    async def _consume_ephemeral_broadcast(self, broadcast_item: Attention | None) -> None:
        """消费事件型广播，避免同一外部输入在后续 tick 被重复处理。"""
        if broadcast_item is None or broadcast_item.source != "perception":
            return
        content = broadcast_item.content if isinstance(broadcast_item.content, dict) else {}
        if not content.get("scene_id") or not content.get("trace_id"):
            return
        if await self._ws.remove(broadcast_item.attention_id):
            self._observability.counter("cognition.workspace_consumed", 1, labels={"source": "perception"})

    @staticmethod
    def _perception_trace(item: Attention | None) -> str:
        if item is None or item.source != "perception" or not isinstance(item.content, dict):
            return ""
        return str(item.content.get("trace_id") or "")

    @staticmethod
    def _is_ambient_perception(item: Attention | None) -> bool:
        return bool(
            item is not None
            and item.source == "perception"
            and isinstance(item.content, dict)
            and item.content.get("address_mode") != "direct"
        )

    def _finish_perception_success(self, item: Attention, outcome: str) -> None:
        if self._perception_operations is None:
            return
        trace_id = self._perception_trace(item)
        if trace_id and self._perception_operations.finish(trace_id, "succeeded"):
            self._observability.counter(
                "cognition.perception_consumed", 1, labels={"outcome": outcome}
            )

    def _finish_unbroadcast_perception(self, item: Attention, outcome: str) -> None:
        """关闭无法广播的感知；只有 direct 丢失属于服务失败。"""
        if self._perception_operations is None:
            return
        trace_id = self._perception_trace(item)
        if not trace_id:
            return
        if self._is_ambient_perception(item):
            self._finish_perception_success(item, outcome)
            return
        if self._perception_operations.finish(
            trace_id, "failed", "直接感知未进入工作区广播"
        ):
            self._observability.counter(
                "cognition.perception_consumed", 1, labels={"outcome": f"direct_{outcome}"}
            )

    async def _safe_propose(
        self, provider: Provider, snapshot: list[Attention]
    ) -> list[Attention]:
        """Provider 异常隔离：单个崩不影响他人。"""
        try:
            return await provider.propose(snapshot)
        except Exception as e:
            self.logger.error(
                "Provider propose 异常",
                provider=provider.name,
                error=str(e),
                exc_info=True,
            )
            self._observability.counter("cognition.provider_error", 1, labels={"provider": provider.name})
            return []

    @property
    def last_arbitration(self) -> ArbitrationResult | None:
        """检视最近一拍的仲裁结果（5.9 切流时 ActionStream 从此取）。"""
        return self._last_arbitration

    def _build_intents(
        self,
        broadcast_item: Attention | None,
        snapshot: list[Attention],
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
                return [self._make_intent(
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
            return [self._make_intent(
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
            return [self._make_intent(
                type="reply",
                initiative="proactive",
                willingness=w,
                payload={"trigger": "drive.companionship", "level": bc.get("level", 0.0)},
            )]
        # 其他来源 → 主动思考
        return [self._make_intent(
            type="thought",
            initiative="proactive",
            willingness=w,
            payload={"source": broadcast_item.source, "content": bc},
        )]

    def _make_intent(self, **values) -> Intent:
        return make_intent(
            **values,
            intent_id=self._ids.new(),
            created_at=self._clock.now_iso(),
        )

    def _gather_willingness_inputs(
        self,
        broadcast_item: Attention,
        snapshot: list[Attention],
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

    async def _persist_checkpoint(self, status: str) -> None:
        if self._checkpoint_store is None:
            return
        saved = await self._checkpoint_store.save(
            LoopCheckpoint(
                checkpoint_key="main",
                cycle_count=self._cycle_count,
                status=status,
                revision=self._checkpoint_revision,
            ),
            expected_revision=self._checkpoint_revision,
        )
        self._checkpoint_revision = saved.revision
