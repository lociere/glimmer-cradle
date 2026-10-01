"""Cognition Worker 的唯一对象组装根。"""

from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.state import CognitiveActivityController
from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanUseCase
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisUseCase
from glimmer_cradle.cognition.context import ContextAssembler
from glimmer_cradle.conversation import (
    ConversationController,
    ConversationStore,
    SqliteTurnStore,
    TurnController,
)
from glimmer_cradle.cognition.application.context.sources import (
    EpisodicMemorySource,
    KnowledgeSource,
    RecentExperienceSource,
    RelationshipSource,
)
from glimmer_cradle.cognition.loop import LoopController
from glimmer_cradle.cognition.attention import AttentionController
from glimmer_cradle.cognition.perception import ObservationQueue, PerceptionOperationRegistry
from glimmer_cradle.cognition.application.cycle.providers import (
    AffectProvider,
    DriveProvider,
    MemoryProvider,
    PerceptionProvider,
    SocialProvider,
)
from glimmer_cradle.cognition.adapters.persistence.experience.episodes import EpisodeProjection
from glimmer_cradle.conversation import ConversationRecorder, build_conversation_recorder
from glimmer_cradle.cognition.adapters.clock import SystemClock
from glimmer_cradle.cognition.adapters.identity import SystemIdGenerator
from glimmer_cradle.cognition.domain.configuration import CharacterRuntimeSettings
from glimmer_cradle.cognition.adapters.paths import (
    resolve_cognition_checkpoint_db_path,
    resolve_cognition_knowledge_db_path,
    resolve_cognition_planning_db_path,
    resolve_cognition_state_db_path,
    resolve_conversation_db_path,
    resolve_episode_projection_path,
    resolve_experience_dir,
)
from glimmer_cradle.cognition.adapters.persistence.sqlite_state_store import SqliteStateStore
from glimmer_cradle.cognition.adapters.persistence.sqlite_planning_store import SqlitePlanningStore
from glimmer_cradle.cognition.adapters.persistence.sqlite_knowledge_store import SqliteKnowledgeStore
from glimmer_cradle.cognition.adapters.persistence.sqlite_checkpoint_store import SqliteCheckpointStore
from glimmer_cradle.cognition.domain.identity.self_entity import SelfEntity
from glimmer_cradle.cognition.adapters.inference.cloud import CloudReasoning
from glimmer_cradle.cognition.adapters.inference.embedding import EmbeddingEngine
from glimmer_cradle.cognition.adapters.inference.gateway import LLMEngine
from glimmer_cradle.cognition.adapters.inference.multimodal import MultimodalRouter
from glimmer_cradle.cognition.inference import InferenceController
from glimmer_cradle.cognition.planning import PlanningController
from glimmer_cradle.cognition.knowledge import KnowledgeIndex
from glimmer_cradle.cognition.memory import ConsolidationCoordinator, MemoryController
from glimmer_cradle.cognition.application.maintenance import MaintenanceScheduler
from glimmer_cradle.cognition.adapters.persistence.memory.relationship_projection import RelationshipProjection
from glimmer_cradle.cognition.adapters.persistence.sqlite_memory_store import SqliteMemoryStore
from glimmer_cradle.cognition.adapters.persistence.memory.memory_repo import MemoryRepository
from glimmer_cradle.cognition.adapters.persistence.memory.consolidation_job_repo import ConsolidationJobRepository
from glimmer_cradle.cognition.adapters.persistence.memory.relationship_repo import RelationshipRepository
from glimmer_cradle.cognition.adapters.persistence.memory.vector_repo import VectorRepository
from glimmer_cradle.cognition.adapters.observability.binding import FileObservability
from glimmer_cradle.cognition.adapters.kernel import (
    CognitionGrpcHost,
    KernelEventInboundAdapter,
    KernelEventOutboundAdapter,
    KernelGrpcClient,
)

@dataclass(frozen=True, slots=True)
class CognitionComponents:
    """由组装根创建并交给 Host 监督生命周期的组件图。"""

    self_entity: SelfEntity
    kernel_client: KernelGrpcClient
    cognition_grpc_host: CognitionGrpcHost
    outbound_adapter: KernelEventOutboundAdapter
    conversation_recorder: ConversationRecorder
    memory_substrate: MemoryController
    knowledge_base: KnowledgeIndex
    knowledge_store: SqliteKnowledgeStore
    checkpoint_store: SqliteCheckpointStore
    activity_controller: CognitiveActivityController
    state_store: SqliteStateStore
    planning_store: SqlitePlanningStore
    cognition_database: SqliteMemoryStore
    conversation_controller: ConversationController
    turn_controller: TurnController
    maintenance_scheduler: MaintenanceScheduler
    cycle_controller: LoopController


def compose_cognition(
    config: CharacterRuntimeSettings,
    *,
    generation: str,
    registration_nonce: str,
    registration_secret: bytearray,
    shutdown,
) -> CognitionComponents:
    """按 Storage、Domain、Inference、Application、Port、Cycle 顺序组装 Cognition。"""
    observability = FileObservability()
    logger = observability.logger("cognition_composition")
    logger.info("Cognition Composition 开始组装")
    memory_config = config.memory
    experience_config = memory_config.experience
    cognition_config = config.cognition

    clock = SystemClock()
    ids = SystemIdGenerator()
    conversation_recorder = build_conversation_recorder(
        resolve_experience_dir(),
        enabled=experience_config.enabled,
        pack_max_size_mb=experience_config.pack_max_size_mb,
        flush_interval_ms=experience_config.flush_interval_ms,
        flush_max_buffer=experience_config.flush_max_buffer,
        clock=clock,
        ids=ids,
        observability=observability,
    )
    cognition_database = SqliteMemoryStore()
    state_store = SqliteStateStore(resolve_cognition_state_db_path())
    planning_store = SqlitePlanningStore(resolve_cognition_planning_db_path())
    knowledge_store = SqliteKnowledgeStore(resolve_cognition_knowledge_db_path())
    checkpoint_store = SqliteCheckpointStore(resolve_cognition_checkpoint_db_path())
    memory_repository = MemoryRepository(cognition_database)
    vector_repository = VectorRepository(cognition_database)
    relationship_repository = RelationshipRepository(cognition_database)
    conversation_controller = ConversationController(
        store=ConversationStore(
            resolve_conversation_db_path(), config=memory_config.conversation
        ),
        recorder=conversation_recorder,
        working_config=memory_config.working,
    )
    turn_controller = TurnController(
        SqliteTurnStore(resolve_conversation_db_path()),
        clock=clock,
    )

    memory_substrate = MemoryController(
        clock=clock,
        token_budget=memory_config.retrieval.token_budget,
        candidate_limit=memory_config.retrieval.candidate_limit,
        result_limit=memory_config.retrieval.result_limit,
    )
    knowledge_base = KnowledgeIndex(observability=observability)
    self_entity = SelfEntity(
        manifest_config=config.manifest,
        inference_config=config.inference,
        profile_config=config.profile,
        dialogue_config=config.dialogue,
        safety_config=config.safety,
        memory=memory_substrate,
        knowledge_base=knowledge_base,
        clock=clock,
        ids=ids,
        observability=observability,
    )
    self_entity.persona.initialize(
        manifest=config.manifest,
        profile=config.profile,
        dialogue=config.dialogue,
        safety=config.safety,
    )
    memory_substrate.bind_repository(memory_repository)
    knowledge_base.bind_repository(knowledge_store)
    knowledge_base.bind_vector_repository(knowledge_store)

    activity_controller = CognitiveActivityController(
        experience_recorder=conversation_recorder,
        clock=clock,
        observability=observability,
        state_store=state_store,
        affect_activation_provider=lambda: float(
            self_entity.emotion_system.get_state().get("intensity", 0.0)
        ),
    )
    self_entity.set_cognitive_activity_provider(activity_controller.get_state)

    llm_engine = LLMEngine(self_entity=self_entity, llm_config=config.llm)
    multimodal_router = MultimodalRouter(inference_config=config.inference)
    multimodal_router.set_llm_engine(llm_engine)
    embedding_engine = _build_embedding_engine(config, knowledge_base)
    memory_substrate.bind_vector_search(
        engine=embedding_engine,
        repository=vector_repository,
        semantic_weight=memory_config.retrieval.semantic_weight,
    )

    agent_plan = AgentPlanUseCase(
        ids=ids, observability=observability,
        self_entity=self_entity, llm_engine=llm_engine
    )
    agent_synthesis = AgentSynthesisUseCase(
        self_entity=self_entity,
        llm_engine=llm_engine,
        persona_compiler=self_entity.persona,
        experience_recorder=conversation_recorder,
        activity_controller=activity_controller,
        turn_controller=turn_controller,
        ids=ids,
        observability=observability,
    )
    inbound_adapter = KernelEventInboundAdapter(
        self_entity=self_entity,
        agent_plan_use_case=agent_plan,
        agent_synthesis_use_case=agent_synthesis,
        conversation_controller=conversation_controller,
    )
    kernel_client = KernelGrpcClient(generation, registration_nonce, registration_secret)
    outbound_adapter = KernelEventOutboundAdapter(kernel_client)

    perception_queue = ObservationQueue(max_size=100)
    perception_operations = PerceptionOperationRegistry()
    workspace = AttentionController(capacity=cognition_config.workspace_capacity, clock=clock)
    relationship_projection = RelationshipProjection(
        recorder=conversation_recorder,
        repository=relationship_repository,
        database=cognition_database,
    )
    context_assembly = ContextAssembler(sources=[
        RecentExperienceSource(conversation_recorder),
        EpisodicMemorySource(memory_substrate, clock=clock),
        KnowledgeSource(knowledge_base),
        RelationshipSource(relationship_repository),
    ], observability=observability)
    reasoning = InferenceController(
        cloud=CloudReasoning(llm_engine), local=None, observability=observability
    )
    planning_controller = PlanningController(
        reasoning,
        observability=observability,
        store=planning_store,
    )

    episode_projection = EpisodeProjection(
        resolve_episode_projection_path(),
        conversation_recorder,
        idle_seconds=experience_config.episode_idle_seconds,
        integrity_check=experience_config.seal_integrity_check,
    )
    consolidation_config = memory_config.consolidation
    consolidation_coordinator = ConsolidationCoordinator(
        episodes=episode_projection,
        memory=memory_substrate,
        jobs=ConsolidationJobRepository(cognition_database),
        llm=llm_engine,
        clock=clock,
        ids=ids,
        observability=observability,
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
        observability=observability,
    )
    activity_controller.on_transition(maintenance_scheduler.notify_activity_transition)
    conversation_recorder.on_recorded(maintenance_scheduler.notify_moment)
    cycle_controller = LoopController(
        workspace=workspace,
        providers=[
            PerceptionProvider(perception_queue, clock=clock, ids=ids),
            AffectProvider(self_entity.emotion_system, clock=clock, ids=ids),
            MemoryProvider(context_assembly, activity_controller=activity_controller,
                           clock=clock, ids=ids),
            DriveProvider(activity_controller=activity_controller, clock=clock, ids=ids),
            SocialProvider(relationship_repository, clock=clock, ids=ids),
        ],
        experience_recorder=conversation_recorder,
        activity_controller=activity_controller,
        emotion_system=self_entity.emotion_system,
        default_tick_interval_ms=cognition_config.default_tick_interval_ms,
        action_sink=outbound_adapter.send_action_command,
        reasoning=reasoning,
        planning_controller=planning_controller,
        checkpoint_store=checkpoint_store,
        persona_compiler=self_entity.persona,
        boundary_validator=self_entity.validate_boundary,
        self_entity=self_entity,
        conversation=conversation_controller,
        multimodal_router=multimodal_router,
        perception_operations=perception_operations,
        turn_controller=turn_controller,
        clock=clock,
        ids=ids,
        observability=observability,
    )

    cognition_grpc_host = CognitionGrpcHost(
        generation=generation,
        inbound=inbound_adapter,
        queue=perception_queue,
        activity=activity_controller,
        cycle=cycle_controller,
        shutdown=shutdown,
        operations=perception_operations,
        workspace=workspace,
    )
    logger.info(
        "Cognition Composition 组装完成",
        workspace_capacity=cognition_config.workspace_capacity,
        tick_interval_ms=cognition_config.default_tick_interval_ms,
    )
    return CognitionComponents(
        self_entity=self_entity,
        kernel_client=kernel_client,
        cognition_grpc_host=cognition_grpc_host,
        outbound_adapter=outbound_adapter,
        conversation_recorder=conversation_recorder,
        memory_substrate=memory_substrate,
        knowledge_base=knowledge_base,
        knowledge_store=knowledge_store,
        checkpoint_store=checkpoint_store,
        activity_controller=activity_controller,
        state_store=state_store,
        planning_store=planning_store,
        cognition_database=cognition_database,
        conversation_controller=conversation_controller,
        turn_controller=turn_controller,
        maintenance_scheduler=maintenance_scheduler,
        cycle_controller=cycle_controller,
    )


def _build_embedding_engine(
    config: CharacterRuntimeSettings, knowledge_base: KnowledgeIndex
) -> EmbeddingEngine:
    engine = EmbeddingEngine(config.embedding)
    knowledge_base.set_embedding_engine(engine)
    return engine
