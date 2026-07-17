"""Cognition 进程的唯一对象组装根。"""

from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.activity import CognitiveActivityController
from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanUseCase
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisUseCase
from glimmer_cradle.cognition.context import ContextAssembly
from glimmer_cradle.cognition.conversation import ConversationController, ConversationStore
from glimmer_cradle.cognition.context.sources import (
    EpisodicMemorySource,
    KnowledgeSource,
    RecentExperienceSource,
    RelationshipSource,
)
from glimmer_cradle.cognition.cycle import CycleController, GlobalWorkspace
from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
from glimmer_cradle.cognition.cycle.providers import (
    AffectProvider,
    DriveProvider,
    MemoryProvider,
    PerceptionProvider,
    SocialProvider,
)
from glimmer_cradle.cognition.experience.episodes import EpisodeProjection
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.foundation.config import CharacterRuntimeConfig, CognitionConfig, MemoryConfig
from glimmer_cradle.cognition.foundation.path_utils import resolve_episode_projection_path, resolve_experience_dir
from glimmer_cradle.cognition.identity.self_entity import SelfEntity
from glimmer_cradle.cognition.inference.cloud import CloudReasoning
from glimmer_cradle.cognition.inference.embedding import EmbeddingEngine
from glimmer_cradle.cognition.inference.gateway import LLMEngine
from glimmer_cradle.cognition.inference.multimodal import MultimodalRouter
from glimmer_cradle.cognition.inference.service import ReasoningService
from glimmer_cradle.cognition.memory.consolidation import ConsolidationCoordinator
from glimmer_cradle.cognition.maintenance import MaintenanceScheduler
from glimmer_cradle.cognition.memory.relationship_projection import RelationshipProjection
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.knowledge_repo import KnowledgeRepository
from glimmer_cradle.cognition.memory.storage.memory_repo import MemoryRepository
from glimmer_cradle.cognition.memory.storage.consolidation_job_repo import ConsolidationJobRepository
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository
from glimmer_cradle.cognition.memory.storage.vector_repo import VectorRepository
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.ports.kernel.inbound.kernel_event_adapter import KernelEventInboundAdapter
from glimmer_cradle.cognition.ports.kernel.inbound.kernel_ingress_cortex import KernelIngressCortex
from glimmer_cradle.cognition.ports.kernel.outbound.kernel_bridge import KernelBridge
from glimmer_cradle.cognition.ports.kernel.outbound.kernel_event_adapter import KernelEventOutboundAdapter
from glimmer_cradle.cognition.protocol.generated.enums.ipc_message_type import IPCMessageType

logger = get_logger("cognition_composition")


@dataclass(frozen=True, slots=True)
class CognitionComponents:
    """由组装根创建并交给 Host 监督生命周期的组件图。"""

    self_entity: SelfEntity
    kernel_bridge: KernelBridge
    outbound_adapter: KernelEventOutboundAdapter
    experience_recorder: ExperienceRecorder
    activity_controller: CognitiveActivityController
    cognition_database: CognitionDatabase
    conversation_controller: ConversationController
    maintenance_scheduler: MaintenanceScheduler
    cycle_controller: CycleController


def compose_cognition(config: CharacterRuntimeConfig) -> CognitionComponents:
    """按 Storage、Domain、Inference、Application、Port、Cycle 顺序组装 Cognition。"""
    logger.info("Cognition Composition 开始组装")

    memory_config = config.memory or MemoryConfig()
    experience_config = memory_config.experience
    cognition_config = config.cognition or CognitionConfig()

    experience_recorder = ExperienceRecorder(
        resolve_experience_dir(),
        enabled=experience_config.enabled,
        pack_max_size_mb=experience_config.pack_max_size_mb,
        flush_interval_ms=experience_config.flush_interval_ms,
        flush_max_buffer=experience_config.flush_max_buffer,
    )
    cognition_database = CognitionDatabase()
    memory_repository = MemoryRepository(cognition_database)
    knowledge_repository = KnowledgeRepository(cognition_database)
    vector_repository = VectorRepository(cognition_database)
    relationship_repository = RelationshipRepository(cognition_database)
    conversation_controller = ConversationController(
        store=ConversationStore(config=memory_config.conversation),
        recorder=experience_recorder,
        working_config=memory_config.working,
    )

    self_entity = SelfEntity(
        manifest_config=config.manifest,
        inference_config=config.inference,
        profile_config=config.profile,
        dialogue_config=config.dialogue,
        safety_config=config.safety,
        memory_config=memory_config,
    )
    self_entity.persona_injector.init(
        manifest_config=config.manifest,
        profile_config=config.profile,
        dialogue_config=config.dialogue,
        safety_config=config.safety,
    )
    self_entity.memory.bind_repository(memory_repository)
    self_entity.knowledge_base.bind_repository(knowledge_repository)
    self_entity.knowledge_base.bind_vector_repository(vector_repository)

    activity_controller = CognitiveActivityController(
        experience_recorder=experience_recorder,
        affect_activation_provider=lambda: float(
            self_entity.emotion_system.get_state().get("intensity", 0.0)
        ),
    )
    self_entity.set_cognitive_activity_provider(activity_controller.get_state)

    llm_engine = LLMEngine(self_entity=self_entity, llm_config=config.llm)
    multimodal_router = MultimodalRouter(inference_config=config.inference)
    multimodal_router.set_llm_engine(llm_engine)
    embedding_engine = _build_embedding_engine(config, self_entity)
    self_entity.memory.bind_vector_search(
        engine=embedding_engine,
        repository=vector_repository,
        semantic_weight=memory_config.retrieval.semantic_weight,
    )

    agent_plan = AgentPlanUseCase(self_entity=self_entity, llm_engine=llm_engine)
    agent_synthesis = AgentSynthesisUseCase(
        self_entity=self_entity,
        llm_engine=llm_engine,
        persona_injector=self_entity.persona_injector,
        experience_recorder=experience_recorder,
        activity_controller=activity_controller,
    )
    inbound_adapter = KernelEventInboundAdapter(
        self_entity=self_entity,
        agent_plan_use_case=agent_plan,
        agent_synthesis_use_case=agent_synthesis,
    )
    ingress_cortex = KernelIngressCortex()
    kernel_bridge = KernelBridge()
    outbound_adapter = KernelEventOutboundAdapter(kernel_bridge=kernel_bridge)

    perception_queue = PerceptionEventQueue(max_size=100)
    workspace = GlobalWorkspace(capacity=cognition_config.workspace_capacity)
    relationship_projection = RelationshipProjection(
        recorder=experience_recorder,
        repository=relationship_repository,
        database=cognition_database,
    )
    context_assembly = ContextAssembly(sources=[
        RecentExperienceSource(experience_recorder),
        EpisodicMemorySource(self_entity.memory),
        KnowledgeSource(self_entity.knowledge_base),
        RelationshipSource(relationship_repository),
    ])
    reasoning = ReasoningService(cloud=CloudReasoning(llm_engine), local=None)

    episode_projection = EpisodeProjection(
        resolve_episode_projection_path(),
        experience_recorder,
        idle_seconds=experience_config.episode_idle_seconds,
        integrity_check=experience_config.seal_integrity_check,
    )
    consolidation_config = memory_config.consolidation
    consolidation_coordinator = ConsolidationCoordinator(
        episodes=episode_projection,
        memory=self_entity.memory,
        jobs=ConsolidationJobRepository(cognition_database),
        llm=llm_engine,
        relationship_projection=relationship_projection,
        enabled=consolidation_config.enabled,
        batch_size=consolidation_config.batch_size,
        max_batch_moments=consolidation_config.max_batch_moments,
        debounce_seconds=consolidation_config.debounce_seconds,
        max_wait_seconds=consolidation_config.max_wait_seconds,
        lease_seconds=consolidation_config.lease_seconds,
        retry_base_seconds=consolidation_config.retry_base_seconds,
        minimum_salience=consolidation_config.minimum_salience,
        autobiographical_evidence_threshold=(
            consolidation_config.autobiographical_evidence_threshold
        ),
    )
    maintenance_scheduler = MaintenanceScheduler(
        consolidation=consolidation_coordinator,
        activity_state_provider=lambda: activity_controller.state.value,
        interval_seconds=consolidation_config.schedule_interval_seconds,
    )
    activity_controller.on_transition(maintenance_scheduler.notify_activity_transition)
    experience_recorder.on_recorded(maintenance_scheduler.notify_moment)
    cycle_controller = CycleController(
        workspace=workspace,
        providers=[
            PerceptionProvider(perception_queue),
            AffectProvider(self_entity.emotion_system),
            MemoryProvider(context_assembly, activity_controller=activity_controller),
            DriveProvider(activity_controller=activity_controller),
            SocialProvider(relationship_repository),
        ],
        experience_recorder=experience_recorder,
        activity_controller=activity_controller,
        emotion_system=self_entity.emotion_system,
        default_tick_interval_ms=cognition_config.default_tick_interval_ms,
        action_sink=outbound_adapter.send_action_command,
        reasoning=reasoning,
        persona_injector=self_entity.persona_injector,
        boundary_validator=self_entity.validate_boundary,
        self_entity=self_entity,
        conversation=conversation_controller,
        multimodal_router=multimodal_router,
    )

    _register_kernel_handlers(
        bridge=kernel_bridge,
        inbound=inbound_adapter,
        ingress=ingress_cortex,
        queue=perception_queue,
        activity=activity_controller,
        cycle=cycle_controller,
    )
    logger.info(
        "Cognition Composition 组装完成",
        workspace_capacity=cognition_config.workspace_capacity,
        tick_interval_ms=cognition_config.default_tick_interval_ms,
    )
    return CognitionComponents(
        self_entity=self_entity,
        kernel_bridge=kernel_bridge,
        outbound_adapter=outbound_adapter,
        experience_recorder=experience_recorder,
        activity_controller=activity_controller,
        cognition_database=cognition_database,
        conversation_controller=conversation_controller,
        maintenance_scheduler=maintenance_scheduler,
        cycle_controller=cycle_controller,
    )


def _build_embedding_engine(
    config: CharacterRuntimeConfig, self_entity: SelfEntity
) -> EmbeddingEngine:
    engine = EmbeddingEngine(config.embedding)
    self_entity.knowledge_base.set_embedding_engine(engine)
    return engine


def _register_kernel_handlers(
    *,
    bridge: KernelBridge,
    inbound: KernelEventInboundAdapter,
    ingress: KernelIngressCortex,
    queue: PerceptionEventQueue,
    activity: CognitiveActivityController,
    cycle: CycleController,
) -> None:
    async def on_perception(message: dict) -> None:
        parsed = ingress.parse_perception_message(message)
        model_input = (
            parsed.model_input
            if isinstance(parsed.model_input, dict)
            else parsed.model_input.model_dump()
        )
        text = model_input.get("text", "") if isinstance(model_input, dict) else ""
        queue.put(PerceptionEntry(
            scene_id=parsed.scene_id,
            conversation_id=parsed.conversation_id,
            continuity_id=parsed.continuity_id,
            thread_id=parsed.thread_id,
            recall_scope=parsed.recall_scope,
            disclosure_scope=parsed.disclosure_scope,
            address_mode=parsed.address_mode,
            familiarity=parsed.familiarity,
            response_policy=parsed.response_policy,
            text=text or "",
            trace_id=parsed.trace_id or "",
            actor_id=model_input.get("actor_id") if isinstance(model_input, dict) else None,
            actor_name=model_input.get("actor_name") if isinstance(model_input, dict) else None,
            model_input=model_input if isinstance(model_input, dict) else None,
            origin=parsed.origin,
            retention_ceiling=parsed.retention_ceiling,
            interaction_id=parsed.interaction_id,
        ))
        try:
            if parsed.address_mode == "direct":
                activity.engage("direct_perception")
            else:
                activity.observe_activity("ambient_perception")
        except Exception as exc:
            logger.warning("感知入站唤醒处理失败", error=str(exc))
        cycle.notify_external_input()
        return None

    async def on_heartbeat() -> dict[str, str]:
        return {"status": "alive"}

    async def on_config_init(message: dict) -> dict[str, str]:
        logger.info(
            "收到 config_init 请求，Cognition 通信通道可用",
            trace_id=message.get("trace_id"),
        )
        return {"status": "ok"}

    bridge.register_handler(IPCMessageType.PERCEPTION_MESSAGE, on_perception)
    bridge.register_handler(IPCMessageType.LIFE_HEARTBEAT, lambda _message: on_heartbeat())
    bridge.register_handler(
        IPCMessageType.KNOWLEDGE_INIT,
        lambda message: inbound.on_knowledge_init(ingress.parse_knowledge_init(message)),
    )
    bridge.register_handler(
        IPCMessageType.AGENT_PLAN,
        lambda message: inbound.on_agent_plan(ingress.parse_agent_plan(message)),
    )
    bridge.register_handler(
        IPCMessageType.AGENT_SYNTHESIS,
        lambda message: inbound.on_agent_synthesis(ingress.parse_agent_synthesis(message)),
    )
    bridge.register_handler(IPCMessageType.CONFIG_INIT, on_config_init)
    bridge.register_handler("heartbeat", lambda _message: on_heartbeat())
