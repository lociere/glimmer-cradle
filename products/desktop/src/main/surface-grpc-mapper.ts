import { create, fromJson, toJson, type JsonObject } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import * as surfaceV1 from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
export type { ProductSurfaceProjection, ProductSurfaceRequest } from './control-center-models';
import type { ProductSurfaceProjection, ProductSurfaceRequest } from './control-center-models';

function object(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function value(value: unknown) {
  return fromJson(ValueSchema, JSON.parse(JSON.stringify(value ?? null)) as never);
}

function readValue(input: unknown): unknown {
  return input ? toJson(ValueSchema, input as never) : undefined;
}

export function queryFromSurfaceRequest(
  frame: ProductSurfaceRequest,
): surfaceV1.SurfaceGatewayServiceQueryRequest['query'] | null {
  switch (frame.kind) {
    case 'config_snapshot_request':
      return { case: 'configurationSnapshot', value: create(surfaceV1.ConfigurationSnapshotQuerySchema, {
        requestId: frame.config_snapshot_request?.request_id ?? '',
      }) };
    case 'conversation_history_request': {
      const request = frame.conversation_history_request;
      return request ? { case: 'conversationHistory', value: create(surfaceV1.ConversationHistoryQuerySchema, {
        requestId: request.request_id, conversationId: request.conversation_id ?? '',
        sceneId: request.scene_id ?? '', threadId: request.thread_id ?? '',
        actorId: request.actor_id ?? '', sourceProviderId: request.source_provider_id ?? '',
        cursor: request.cursor ?? '', limit: request.limit ?? 50,
      }) } : null;
    }
    case 'skill_catalog_request':
      return { case: 'skillCatalog', value: create(surfaceV1.SkillCatalogQuerySchema, {
        requestId: frame.skill_catalog_request?.request_id ?? '',
      }) };
    case 'extension_runtime_projection_request':
      return { case: 'extensionRuntimeProjection', value: create(surfaceV1.ExtensionRuntimeProjectionQuerySchema, {
        requestId: frame.extension_runtime_projection_request?.request_id ?? '',
        extensionId: frame.extension_runtime_projection_request?.extension_id ?? '',
      }) };
    default:
      return null;
  }
}

export function commandFromSurfaceRequest(
  frame: ProductSurfaceRequest,
): surfaceV1.SurfaceGatewayServiceCommandRequest['command'] | null {
  switch (frame.kind) {
    case 'heartbeat':
      return { case: 'heartbeat', value: create(surfaceV1.HeartbeatCommandSchema) };
    case 'chat_input':
      return frame.chat_input ? { case: 'chatInput', value: create(surfaceV1.ChatInputCommandSchema, {
        text: frame.chat_input.text, sourceSuffix: frame.chat_input.source_suffix ?? '',
      }) } : null;
    case 'audio_input':
      return frame.audio_input ? { case: 'audioInput', value: create(surfaceV1.AudioInputCommandSchema, {
        audioId: frame.audio_input.audio_id,
        audio: Buffer.from(frame.audio_input.audio_data, 'base64'),
        mimeType: frame.audio_input.mime_type,
        durationMs: frame.audio_input.duration_ms ?? 0,
        sampleRate: frame.audio_input.sample_rate ?? 0,
      }) } : null;
    case 'avatar_presentation':
      return frame.avatar_presentation ? { case: 'avatarPresentation', value: create(surfaceV1.AvatarPresentationCommandSchema, {
        placementId: frame.avatar_presentation.placement_id ?? '',
        displayScale: frame.avatar_presentation.display_scale ?? 0,
        resetPlacement: frame.avatar_presentation.reset_placement ?? false,
      }) } : null;
    case 'avatar_intent':
      return frame.avatar_intent ? { case: 'avatarIntent', value: create(surfaceV1.AvatarIntentCommandSchema, {
        actionId: frame.avatar_intent.action_id,
        operation: frame.avatar_intent.operation,
        priority: frame.avatar_intent.priority ?? 0,
      }) } : null;
    case 'core_skill_action_response':
      return { case: 'coreSkillActionResponse', value: create(surfaceV1.CoreSkillActionResponseCommandSchema, {
        requestId: frame.request_id, status: frame.status,
        result: frame.result === undefined ? undefined : value(frame.result),
        message: frame.message ?? '', errorCode: frame.error_code ?? '',
        operationId: frame.operation_id ?? '', recoveryActions: frame.recovery_actions ?? [],
      }) };
    case 'core_skill_confirmation_response':
      return { case: 'coreSkillConfirmationResponse', value: create(surfaceV1.CoreSkillConfirmationResponseCommandSchema, {
        requestId: frame.request_id, status: frame.status,
        approved: Boolean((frame.result as { approved?: unknown } | undefined)?.approved),
        message: frame.message ?? '',
      }) };
    case 'config_update_request': {
      const request = frame.config_update_request;
      return request ? { case: 'configurationUpdate', value: create(surfaceV1.ConfigurationUpdateCommandSchema, {
        requestId: request.request_id, revision: request.revision, dryRun: request.dry_run ?? false,
        llm: object(request.llm), audio: object(request.audio), embedding: object(request.embedding),
        memory: object(request.memory), skills: object(request.skills),
      }) } : null;
    }
    case 'config_test_request':
      return frame.config_test_request ? { case: 'configurationTest', value: create(surfaceV1.ConfigurationTestCommandSchema, {
        requestId: frame.config_test_request.request_id, provider: object(frame.config_test_request.provider),
      }) } : null;
    case 'extension_install_prepare': {
      const request = frame.extension_install_prepare;
      if (!request) return null;
      const source = request.source as Record<string, unknown>;
      return { case: 'extensionInstallPrepare', value: create(surfaceV1.ExtensionInstallPrepareCommandSchema, {
        requestId: request.request_id,
        source: create(surfaceV1.ExtensionInstallSourceSchema, {
          kind: String(source.kind ?? ''), path: String(source.path ?? ''), url: String(source.url ?? ''),
          catalogUrl: String(source.catalog_url ?? ''), extensionId: String(source.extension_id ?? ''),
          channel: String(source.channel ?? ''), repository: String(source.repository ?? ''), tag: String(source.tag ?? ''),
        }),
      }) };
    }
    case 'extension_install_commit':
      return frame.extension_install_commit ? { case: 'extensionInstallCommit', value: create(surfaceV1.ExtensionInstallCommitCommandSchema, {
        requestId: frame.extension_install_commit.request_id,
        transactionId: frame.extension_install_commit.transaction_id,
        approvedPermissions: frame.extension_install_commit.approved_permissions as string[],
      }) } : null;
    case 'extension_install_cancel':
      return frame.extension_install_cancel ? { case: 'extensionInstallCancel', value: create(surfaceV1.ExtensionInstallCancelCommandSchema, {
        requestId: frame.extension_install_cancel.request_id,
        transactionId: frame.extension_install_cancel.transaction_id,
      }) } : null;
    case 'extension_uninstall_request':
      return frame.extension_uninstall_request ? { case: 'extensionUninstall', value: create(surfaceV1.ExtensionUninstallCommandSchema, {
        requestId: frame.extension_uninstall_request.request_id,
        extensionId: frame.extension_uninstall_request.extension_id,
        version: frame.extension_uninstall_request.version,
      }) } : null;
    case 'extension_lifecycle_request':
      return frame.extension_lifecycle_request ? { case: 'extensionLifecycle', value: create(surfaceV1.ExtensionLifecycleCommandSchema, {
        requestId: frame.extension_lifecycle_request.request_id,
        extensionId: frame.extension_lifecycle_request.extension_id,
        version: frame.extension_lifecycle_request.version ?? '',
        operation: frame.extension_lifecycle_request.operation,
      }) } : null;
    case 'extension_command_request':
      return frame.extension_command_request ? { case: 'extensionCommand', value: create(surfaceV1.ExtensionCommandSchema, {
        requestId: frame.extension_command_request.request_id,
        commandId: frame.extension_command_request.command_id,
        args: frame.extension_command_request.args.map(value),
      }) } : null;
    case 'shutdown_request':
      return frame.shutdown_request?.requested_by === 'control-surface'
        ? { case: 'shutdown', value: create(surfaceV1.ShutdownCommandSchema, { reason: frame.shutdown_request.reason ?? '' }) }
        : null;
    default:
      return null;
  }
}

export function surfaceEventToProjection(event: surfaceV1.SurfaceEvent | undefined): ProductSurfaceProjection | null {
  if (!event) return null;
  const base = { trace_id: event.traceId || undefined, timestamp: Number(event.timestampMs) };
  const item = event.event;
  switch (item.case) {
    case 'reply': return {
      kind: 'reply', ...base,
      reply: {
        text: item.value.text,
        messages: item.value.messages.map((message) => ({
          sequence: message.sequence,
          content_type: message.contentType as 'text' | 'code',
          text: message.text,
          language: message.language || undefined,
        })),
        emotion_snapshot: item.value.emotionSnapshot ? {
          emotion_type: item.value.emotionSnapshot.emotionType,
          intensity: item.value.emotionSnapshot.intensity,
          trigger: item.value.emotionSnapshot.trigger || undefined,
        } : undefined,
      },
    };
    case 'emotion': return item.value.emotion ? { kind: 'emotion', ...base, emotion: {
      emotion_type: item.value.emotion.emotionType, intensity: item.value.emotion.intensity,
      trigger: item.value.emotion.trigger || undefined,
    } } : null;
    case 'thought': return { kind: 'thought', ...base, thought: { active: item.value.active, hint: item.value.hint || undefined } };
    case 'audioPlay': return { kind: 'audio_play', ...base, audio_play: {
      audio_id: item.value.audioId, audio_uri: item.value.audioUri || undefined,
      mime_type: item.value.mimeType || undefined, duration_ms: item.value.durationMs || undefined,
    } };
    case 'audioTranscript': return { kind: 'audio_transcript', ...base, audio_transcript: {
      audio_id: item.value.audioId, status: item.value.status as 'success' | 'error',
      text: item.value.text || undefined, message: item.value.message || undefined,
    } };
    case 'characterPresentation': return { kind: 'character_presentation_projection', ...base, character_presentation_projection: {
      avatar_package_id: item.value.avatarPackageId, model_id: item.value.modelId, display_name: item.value.displayName,
      kind: 'live2d', backend: 'unity', host_kind: item.value.hostKind as 'unity' | 'offline',
      avatar_state: item.value.avatarState as 'pending' | 'starting' | 'ready' | 'degraded' | 'stopped',
      appearance: { placement_id: item.value.placementId || undefined, display_scale: item.value.displayScale },
      lifecycle: {
        worker_window_state: item.value.workerWindowState as 'isolated' | 'visible' | 'unknown',
        composition_surface_state: item.value.compositionSurfaceState as 'attached' | 'failed' | 'unknown',
        first_frame_presented: item.value.firstFramePresented, interaction_ready: item.value.interactionReady,
        ready: item.value.ready, summary: item.value.summary,
      },
    } };
    case 'avatarStatus': return { kind: 'avatar_status', ...base, avatar_status: {
      host_kind: item.value.hostKind as 'unity' | 'offline', host_id: item.value.hostId || undefined,
    } };
    case 'avatarActionState': return { kind: 'avatar_action_state', ...base, avatar_action_state: {
      action_id: item.value.actionId || undefined,
      state: item.value.state ? item.value.state as 'inactive' | 'active' | 'running' | 'completed' | 'rejected' : undefined,
      active_action_ids: item.value.activeActionIds, message: item.value.message || undefined,
    } };
    case 'runtimeReadiness': return { kind: 'runtime_readiness', ...base, runtime_readiness: {
      updated_at: Number(item.value.updatedAtMs),
      runtimes: item.value.runtimes.map((runtime) => ({
        runtime_id: runtime.runtimeId, owner: runtime.owner as never, phase: runtime.phase, state: runtime.state as never,
        blocking: runtime.blocking, summary: runtime.summary, details_ref: runtime.detailsRef || undefined,
        duration_ms: runtime.durationMs ? Number(runtime.durationMs) : undefined,
        reconciler: runtime.reconciler ? {
          desired: runtime.reconciler.desired, actual: runtime.reconciler.actual,
          readiness: runtime.reconciler.readiness as never,
          resources: runtime.reconciler.resources.map((resource) => ({
            resource_id: resource.resourceId, resource_kind: resource.resourceKind,
            desired_state: resource.desiredState as never, actual_state: resource.actualState as never,
            readiness: resource.readiness as never, summary: resource.summary,
            recovery_actions: resource.recoveryActions,
          })),
        } : undefined,
      })),
    } };
    case 'audioStatus': return { kind: 'audio_status', ...base, audio_status: {
      updated_at: Number(item.value.updatedAtMs),
      tts: audioCapability(item.value.tts), asr: audioCapability(item.value.asr),
    } };
    case 'conversationNotice': return { kind: 'conversation_notice', ...base, conversation_notice: {
      code: item.value.code, level: item.value.level as never, title: item.value.title, message: item.value.message,
      action_route: item.value.actionRoute || undefined, action_label: item.value.actionLabel || undefined,
    } };
    case 'conversationHistoryResult': return { kind: 'conversation_history_result', ...base, conversation_history_result: {
      request_id: item.value.requestId, status: item.value.status as 'success' | 'error',
      conversation: item.value.conversation ? {
        source_provider_id: item.value.conversation.sourceProviderId, scene_id: item.value.conversation.sceneId,
        conversation_id: item.value.conversation.conversationId, thread_id: item.value.conversation.threadId,
        recall_scope: item.value.conversation.recallScope, disclosure_scope: item.value.conversation.disclosureScope,
      } : undefined,
      items: item.value.items.map((entry) => ({
        entry_id: entry.entryId, source_kind: entry.sourceKind as never, role: entry.role as never,
        trace_id: entry.traceId, interaction_id: entry.interactionId, position: entry.position == null ? undefined : Number(entry.position),
        title: entry.title, moment_id: entry.momentId, actor_id: entry.actorId, actor_name: entry.actorName,
        status: entry.status as never, text: entry.text, occurred_at: entry.occurredAt,
        conversation_id: entry.conversationId, scene_id: entry.sceneId, thread_id: entry.threadId,
        recall_scope: entry.recallScope, disclosure_scope: entry.disclosureScope,
      })),
      next_cursor: item.value.nextCursor || undefined, has_more: item.value.hasMore,
      message: item.value.message || undefined,
    } };
    case 'configurationSnapshot': return { kind: 'configuration_snapshot_result', ...base, configuration_snapshot_result: {
      request_id: item.value.requestId, status: item.value.status as 'success' | 'error',
      snapshot: item.value.snapshot as never, message: item.value.message || undefined,
    } };
    case 'configurationUpdate': return { kind: 'configuration_update_result', ...base, configuration_update_result: {
      request_id: item.value.requestId, status: item.value.status as 'success' | 'error',
      apply_state: item.value.applyState as never, change_summary: item.value.changeSummary,
      snapshot: item.value.snapshot as never, message: item.value.message || undefined,
    } };
    case 'configurationTest': return { kind: 'configuration_test_result', ...base, configuration_test_result: {
      request_id: item.value.requestId, status: item.value.status as 'success' | 'error',
      message: item.value.message, discovered_models: item.value.discoveredModels,
      latency_ms: item.value.latencyMs ? Number(item.value.latencyMs) : undefined,
    } };
    case 'skillCatalog': return { kind: 'skill_catalog_response', ...base, skill_catalog_response: {
      request_id: item.value.requestId, status: item.value.status as 'success' | 'error',
      snapshot: item.value.snapshot as never, message: item.value.message || undefined,
    } };
    case 'extensionInstallPreview': return { kind: 'extension_install_preview', ...base, extension_install_preview: {
      request_id: item.value.requestId, status: item.value.status as never,
      transaction_id: item.value.transactionId || undefined, extension: item.value.extension as never,
      artifact: item.value.artifact as never, trust: item.value.trust as never,
      message: item.value.message || undefined,
    } };
    case 'extensionInstallResult': return { kind: 'extension_install_result', ...base, extension_install_result: {
      request_id: item.value.requestId, status: item.value.status as never,
      extension_id: item.value.extensionId || undefined, version: item.value.version || undefined,
      already_installed: item.value.alreadyInstalled, message: item.value.message || undefined,
    } };
    case 'extensionUninstallResult': return { kind: 'extension_uninstall_result', ...base, extension_uninstall_result: {
      request_id: item.value.requestId, extension_id: item.value.extensionId, version: item.value.version,
      status: item.value.status as never, message: item.value.message || undefined,
    } };
    case 'extensionLifecycleResult': return { kind: 'extension_lifecycle_result', ...base, extension_lifecycle_result: {
      request_id: item.value.requestId, extension_id: item.value.extensionId, version: item.value.version || undefined,
      operation: item.value.operation as never, status: item.value.status as never, message: item.value.message || undefined,
    } as never };
    case 'extensionCommandResult': return { kind: 'extension_command_result', ...base, extension_command_result: {
      request_id: item.value.requestId, command_id: item.value.commandId, status: item.value.status as never,
      result: readValue(item.value.result), message: item.value.message || undefined,
    } as never };
    case 'extensionRuntimeProjectionResult': return { kind: 'extension_runtime_projection_result', ...base, extension_runtime_projection_result: {
      request_id: item.value.requestId, status: item.value.status as never,
      projections: item.value.projections as never, installations: item.value.installations as never,
      message: item.value.message || undefined,
    } };
    case 'extensionRuntimeProjectionChanged': return { kind: 'extension_runtime_projection_changed', ...base, extension_runtime_projection_changed: item.value.projection as never };
    case 'extensionStatusChanged': return { kind: 'extension_status_changed', ...base, extension_status_changed: {
      extension_id: item.value.extensionId, event: item.value.event as never, message: item.value.message || undefined,
    } };
    case 'coreSkillActionRequest': return {
      kind: 'core_skill_action_request', ...base, request_id: item.value.requestId,
      action: item.value.action, payload: item.value.payload as Record<string, unknown>,
    };
    case 'coreSkillConfirmationRequest': return {
      kind: 'core_skill_confirmation_request', ...base, request_id: item.value.requestId,
      confirmation: {
        trace_id: item.value.traceId, skill_id: item.value.skillId, target_kind: item.value.targetKind,
        target_name: item.value.targetName, risk_level: item.value.riskLevel, side_effects: item.value.sideEffects,
      },
    };
    case 'shutdown': return { kind: 'shutdown', ...base };
    default: return null;
  }
}

function audioCapability(value: surfaceV1.AudioCapabilityProjection | undefined): NonNullable<ProductSurfaceProjection['audio_status']>['tts'] {
  return {
    enabled: value?.enabled ?? false, disabled_reason: value?.disabledReason || undefined,
    active_provider: value?.activeProvider || undefined, route_state: (value?.routeState || 'unknown') as never,
    providers: (value?.providers ?? []).map((provider) => ({
      provider_id: provider.providerId, role: provider.role as never, execution: provider.execution as never,
      status: provider.status as never, message: provider.message || undefined,
    })),
  };
}
