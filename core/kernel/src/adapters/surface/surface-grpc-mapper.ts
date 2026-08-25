import { create, fromJson, toJson, type JsonObject } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import * as surfaceV1 from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import type { AudioCapabilityStatus } from '../audio/audio-status-projection';
export type { SurfaceProjectionFrame, SurfaceRequestFrame } from './surface-models';
import type { SurfaceProjectionFrame, SurfaceRequestFrame } from './surface-models';

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}

function jsonValue(value: unknown) {
  return fromJson(ValueSchema, JSON.parse(JSON.stringify(value ?? null)) as never);
}

function fromStruct(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function fromValue(value: unknown): unknown {
  return value ? toJson(ValueSchema, value as never) : undefined;
}

export function queryRequestToSurfaceFrame(
  request: surfaceV1.SurfaceGatewayServiceQueryRequest,
): SurfaceRequestFrame | null {
  const query = request.query;
  switch (query.case) {
    case 'configurationSnapshot':
      return {
        kind: 'config_snapshot_request', timestamp: Date.now(),
        config_snapshot_request: { request_id: query.value.requestId },
      };
    case 'conversationHistory':
      return {
        kind: 'conversation_history_request', timestamp: Date.now(),
        conversation_history_request: {
          request_id: query.value.requestId,
          conversation_id: query.value.conversationId || undefined,
          scene_id: query.value.sceneId || undefined,
          thread_id: query.value.threadId || undefined,
          actor_id: query.value.actorId || undefined,
          source_provider_id: query.value.sourceProviderId || undefined,
          cursor: query.value.cursor || undefined,
          limit: query.value.limit || 50,
        },
      };
    case 'skillCatalog':
      return {
        kind: 'skill_catalog_request', timestamp: Date.now(),
        skill_catalog_request: { request_id: query.value.requestId },
      };
    case 'extensionRuntimeProjection':
      return {
        kind: 'extension_runtime_projection_request', timestamp: Date.now(),
        extension_runtime_projection_request: {
          request_id: query.value.requestId,
          extension_id: query.value.extensionId || undefined,
        },
      };
    default:
      return null;
  }
}

export function commandRequestToSurfaceFrame(
  request: surfaceV1.SurfaceGatewayServiceCommandRequest,
): SurfaceRequestFrame | null {
  const traceId = request.call?.traceId || undefined;
  const base = { trace_id: traceId, timestamp: Date.now() };
  const command = request.command;
  switch (command.case) {
    case 'heartbeat': return { kind: 'heartbeat', ...base };
    case 'chatInput': return {
      kind: 'chat_input', ...base,
      chat_input: { text: command.value.text, source_suffix: command.value.sourceSuffix || undefined },
    };
    case 'audioInput': return {
      kind: 'audio_input', ...base,
      audio_input: {
        audio_id: command.value.audioId,
        audio_data: Buffer.from(command.value.audio).toString('base64'),
        mime_type: command.value.mimeType,
        duration_ms: command.value.durationMs || undefined,
        sample_rate: command.value.sampleRate || undefined,
      },
    };
    case 'avatarPresentation': return {
      kind: 'avatar_presentation', ...base,
      avatar_presentation: {
        placement_id: command.value.placementId || undefined,
        display_scale: command.value.displayScale || undefined,
        reset_placement: command.value.resetPlacement || undefined,
      },
    };
    case 'avatarIntent': return {
      kind: 'avatar_intent', ...base,
      avatar_intent: {
        action_id: command.value.actionId,
        operation: command.value.operation as 'trigger' | 'activate' | 'deactivate',
        priority: command.value.priority || undefined,
      },
    };
    case 'coreSkillActionResponse': return {
      kind: 'core_skill_action_response', ...base,
      request_id: command.value.requestId,
      status: command.value.status === 'success' ? 'success' : 'error',
      result: fromValue(command.value.result),
      message: command.value.message || undefined,
      error_code: command.value.errorCode || undefined,
      operation_id: command.value.operationId || undefined,
      recovery_actions: command.value.recoveryActions,
    };
    case 'coreSkillConfirmationResponse': return {
      kind: 'core_skill_confirmation_response', ...base,
      request_id: command.value.requestId,
      status: command.value.status === 'success' ? 'success' : 'error',
      result: { approved: command.value.approved },
      message: command.value.message || undefined,
    };
    case 'configurationUpdate': return {
      kind: 'config_update_request', ...base,
      config_update_request: {
        request_id: command.value.requestId,
        revision: command.value.revision,
        dry_run: command.value.dryRun,
        llm: fromStruct(command.value.llm) as never,
        audio: fromStruct(command.value.audio) as never,
        embedding: fromStruct(command.value.embedding) as never,
        memory: fromStruct(command.value.memory) as never,
        skills: fromStruct(command.value.skills) as never,
      },
    };
    case 'configurationTest': return {
      kind: 'config_test_request', ...base,
      config_test_request: {
        request_id: command.value.requestId,
        provider: fromStruct(command.value.provider) as never,
      },
    };
    case 'extensionInstallPrepare': return {
      kind: 'extension_install_prepare', ...base,
      extension_install_prepare: {
        request_id: command.value.requestId,
        source: extensionSourceFromDto(command.value.source),
      },
    };
    case 'extensionInstallCommit': return {
      kind: 'extension_install_commit', ...base,
      extension_install_commit: {
        request_id: command.value.requestId,
        transaction_id: command.value.transactionId,
        approved_permissions: command.value.approvedPermissions as never,
      },
    };
    case 'extensionInstallCancel': return {
      kind: 'extension_install_cancel', ...base,
      extension_install_cancel: {
        request_id: command.value.requestId,
        transaction_id: command.value.transactionId,
      },
    };
    case 'extensionUninstall': return {
      kind: 'extension_uninstall_request', ...base,
      extension_uninstall_request: {
        request_id: command.value.requestId,
        extension_id: command.value.extensionId,
        version: command.value.version,
      },
    };
    case 'extensionLifecycle': return {
      kind: 'extension_lifecycle_request', ...base,
      extension_lifecycle_request: {
        request_id: command.value.requestId,
        extension_id: command.value.extensionId,
        version: command.value.version || undefined,
        operation: command.value.operation as 'start' | 'stop',
      },
    };
    case 'extensionCommand': return {
      kind: 'extension_command_request', ...base,
      extension_command_request: {
        request_id: command.value.requestId,
        command_id: command.value.commandId,
        args: command.value.args.map(fromValue),
      },
    };
    case 'shutdown': return {
      kind: 'shutdown_request', ...base,
      shutdown_request: { requested_by: 'control-surface', reason: command.value.reason || undefined },
    };
    default: return null;
  }
}

function extensionSourceFromDto(source: surfaceV1.ExtensionInstallSource | undefined): never {
  if (!source) return {} as never;
  if (source.kind === 'file') return { kind: 'file', path: source.path } as never;
  if (source.kind === 'release_manifest') return { kind: 'release_manifest', url: source.url } as never;
  if (source.kind === 'registry') return {
    kind: 'registry', catalog_url: source.catalogUrl, extension_id: source.extensionId,
    channel: source.channel || undefined,
  } as never;
  return { kind: 'repository', repository: source.repository, tag: source.tag || undefined } as never;
}

export function surfaceEventFromFrame(frame: SurfaceProjectionFrame): surfaceV1.SurfaceEvent | null {
  const base = {
    eventId: crypto.randomUUID(),
    traceId: frame.trace_id ?? '',
    timestampMs: BigInt(Math.max(0, Math.trunc(frame.timestamp))),
  };
  const value = eventValueFromFrame(frame);
  return value ? create(surfaceV1.SurfaceEventSchema, { ...base, event: value }) : null;
}

function eventValueFromFrame(frame: SurfaceProjectionFrame): surfaceV1.SurfaceEvent['event'] | null {
  switch (frame.kind) {
    case 'reply': {
      const payload = frame.reply;
      if (!payload) return null;
      return { case: 'reply', value: create(surfaceV1.ReplyEventSchema, {
        text: payload.text,
        messages: (payload.messages ?? []).map((item) => create(surfaceV1.ReplyMessageSchema, {
          sequence: item.sequence, contentType: item.content_type, text: item.text, language: item.language ?? '',
        })),
        emotionSnapshot: payload.emotion_snapshot ? create(surfaceV1.EmotionProjectionSchema, {
          emotionType: payload.emotion_snapshot.emotion_type,
          intensity: payload.emotion_snapshot.intensity,
          trigger: payload.emotion_snapshot.trigger ?? '',
          blendTimeMs: payload.emotion_snapshot.blend_time_ms ?? 0,
        }) : undefined,
      }) };
    }
    case 'emotion': return frame.emotion ? { case: 'emotion', value: create(surfaceV1.EmotionEventSchema, {
      emotion: create(surfaceV1.EmotionProjectionSchema, {
        emotionType: frame.emotion.emotion_type, intensity: frame.emotion.intensity,
        trigger: frame.emotion.trigger ?? '', blendTimeMs: frame.emotion.blend_time_ms ?? 0,
      }),
    }) } : null;
    case 'thought': return frame.thought ? { case: 'thought', value: create(surfaceV1.ThoughtEventSchema, {
      active: frame.thought.active, hint: frame.thought.hint ?? '',
    }) } : null;
    case 'audio_play': return frame.audio_play ? { case: 'audioPlay', value: create(surfaceV1.AudioPlayEventSchema, {
      audioId: frame.audio_play.audio_id, audioUri: frame.audio_play.audio_uri ?? '',
      mimeType: frame.audio_play.mime_type ?? '', durationMs: frame.audio_play.duration_ms ?? 0,
    }) } : null;
    case 'audio_transcript': return frame.audio_transcript ? { case: 'audioTranscript', value: create(surfaceV1.AudioTranscriptEventSchema, {
      audioId: frame.audio_transcript.audio_id, status: frame.audio_transcript.status,
      text: frame.audio_transcript.text ?? '', message: frame.audio_transcript.message ?? '',
    }) } : null;
    case 'character_presentation_projection': {
      const p = frame.character_presentation_projection;
      return p ? { case: 'characterPresentation', value: create(surfaceV1.CharacterPresentationEventSchema, {
        avatarPackageId: p.avatar_package_id, modelId: p.model_id, displayName: p.display_name,
        kind: p.kind, backend: p.backend, hostKind: p.host_kind, avatarState: p.avatar_state,
        placementId: p.appearance.placement_id ?? '', displayScale: p.appearance.display_scale,
        workerWindowState: p.lifecycle.worker_window_state,
        compositionSurfaceState: p.lifecycle.composition_surface_state,
        firstFramePresented: p.lifecycle.first_frame_presented,
        interactionReady: p.lifecycle.interaction_ready, ready: p.lifecycle.ready, summary: p.lifecycle.summary,
      }) } : null;
    }
    case 'avatar_status': return frame.avatar_status ? { case: 'avatarStatus', value: create(surfaceV1.AvatarStatusEventSchema, {
      hostKind: frame.avatar_status.host_kind, hostId: frame.avatar_status.host_id ?? '',
    }) } : null;
    case 'avatar_action_state': return frame.avatar_action_state ? { case: 'avatarActionState', value: create(surfaceV1.AvatarActionStateEventSchema, {
      actionId: frame.avatar_action_state.action_id ?? '', state: frame.avatar_action_state.state ?? '',
      activeActionIds: frame.avatar_action_state.active_action_ids, message: frame.avatar_action_state.message ?? '',
    }) } : null;
    case 'runtime_readiness': return frame.runtime_readiness ? { case: 'runtimeReadiness', value: create(surfaceV1.RuntimeReadinessEventSchema, {
      updatedAtMs: BigInt(frame.runtime_readiness.updated_at),
      runtimes: frame.runtime_readiness.runtimes.map((item) => create(surfaceV1.RuntimeReadinessItemSchema, {
        runtimeId: item.runtime_id, owner: item.owner, phase: item.phase, state: item.state,
        blocking: item.blocking, summary: item.summary, detailsRef: item.details_ref ?? '',
        durationMs: BigInt(item.duration_ms ?? 0),
        reconciler: item.reconciler ? create(surfaceV1.RuntimeReconcilerProjectionSchema, {
          desired: item.reconciler.desired, actual: item.reconciler.actual, readiness: item.reconciler.readiness,
          resources: item.reconciler.resources.map((resource) => create(surfaceV1.RuntimeResourceProjectionSchema, {
            resourceId: resource.resource_id, resourceKind: resource.resource_kind,
            desiredState: resource.desired_state, actualState: resource.actual_state,
            readiness: resource.readiness, summary: resource.summary, recoveryActions: resource.recovery_actions,
          })),
        }) : undefined,
      })),
    }) } : null;
    case 'audio_status': return frame.audio_status ? { case: 'audioStatus', value: create(surfaceV1.AudioStatusEventSchema, {
      updatedAtMs: BigInt(frame.audio_status.updated_at),
      tts: audioCapability(frame.audio_status.tts), asr: audioCapability(frame.audio_status.asr),
    }) } : null;
    case 'conversation_notice': return frame.conversation_notice ? { case: 'conversationNotice', value: create(surfaceV1.ConversationNoticeEventSchema, {
      code: frame.conversation_notice.code, level: frame.conversation_notice.level,
      title: frame.conversation_notice.title, message: frame.conversation_notice.message,
      actionRoute: frame.conversation_notice.action_route ?? '', actionLabel: frame.conversation_notice.action_label ?? '',
    }) } : null;
    case 'conversation_history_result': return frame.conversation_history_result ? { case: 'conversationHistoryResult', value: create(surfaceV1.ConversationHistoryResultEventSchema, {
      requestId: frame.conversation_history_result.request_id, status: frame.conversation_history_result.status,
      conversation: frame.conversation_history_result.conversation ? create(surfaceV1.ConversationAddressProjectionSchema, {
        sourceProviderId: frame.conversation_history_result.conversation.source_provider_id,
        sceneId: frame.conversation_history_result.conversation.scene_id,
        conversationId: frame.conversation_history_result.conversation.conversation_id,
        threadId: frame.conversation_history_result.conversation.thread_id,
        recallScope: frame.conversation_history_result.conversation.recall_scope,
        disclosureScope: frame.conversation_history_result.conversation.disclosure_scope,
      }) : undefined,
      items: frame.conversation_history_result.items.map((item) => create(surfaceV1.ConversationHistoryEntryProjectionSchema, {
        entryId: item.entry_id, sourceKind: item.source_kind, role: item.role, status: item.status,
        text: item.text, occurredAt: item.occurred_at, conversationId: item.conversation_id,
        sceneId: item.scene_id, threadId: item.thread_id, recallScope: item.recall_scope,
        disclosureScope: item.disclosure_scope,
      })),
      nextCursor: frame.conversation_history_result.next_cursor ?? '',
      hasMore: frame.conversation_history_result.has_more, message: frame.conversation_history_result.message ?? '',
    }) } : null;
    case 'configuration_snapshot_result': return frame.configuration_snapshot_result ? { case: 'configurationSnapshot', value: create(surfaceV1.ConfigurationSnapshotEventSchema, {
      requestId: frame.configuration_snapshot_result.request_id, status: frame.configuration_snapshot_result.status,
      snapshot: frame.configuration_snapshot_result.snapshot ? jsonObject(frame.configuration_snapshot_result.snapshot) : undefined,
      message: frame.configuration_snapshot_result.message ?? '',
    }) } : null;
    case 'configuration_update_result': return frame.configuration_update_result ? { case: 'configurationUpdate', value: create(surfaceV1.ConfigurationUpdateEventSchema, {
      requestId: frame.configuration_update_result.request_id, status: frame.configuration_update_result.status,
      applyState: frame.configuration_update_result.apply_state, changeSummary: frame.configuration_update_result.change_summary,
      snapshot: frame.configuration_update_result.snapshot ? jsonObject(frame.configuration_update_result.snapshot) : undefined,
      message: frame.configuration_update_result.message ?? '',
    }) } : null;
    case 'configuration_test_result': return frame.configuration_test_result ? { case: 'configurationTest', value: create(surfaceV1.ConfigurationTestEventSchema, {
      requestId: frame.configuration_test_result.request_id, status: frame.configuration_test_result.status,
      message: frame.configuration_test_result.message ?? '', discoveredModels: frame.configuration_test_result.discovered_models,
      latencyMs: BigInt(frame.configuration_test_result.latency_ms ?? 0),
    }) } : null;
    case 'skill_catalog_response': return frame.skill_catalog_response ? { case: 'skillCatalog', value: create(surfaceV1.SkillCatalogEventSchema, {
      requestId: frame.skill_catalog_response.request_id, status: frame.skill_catalog_response.status,
      snapshot: frame.skill_catalog_response.snapshot ? jsonObject(frame.skill_catalog_response.snapshot) : undefined,
      message: frame.skill_catalog_response.message ?? '',
    }) } : null;
    case 'extension_install_preview': return frame.extension_install_preview ? { case: 'extensionInstallPreview', value: create(surfaceV1.ExtensionInstallPreviewEventSchema, {
      requestId: frame.extension_install_preview.request_id, status: frame.extension_install_preview.status,
      transactionId: frame.extension_install_preview.transaction_id ?? '',
      extension: frame.extension_install_preview.extension ? jsonObject(frame.extension_install_preview.extension) : undefined,
      artifact: frame.extension_install_preview.artifact ? jsonObject(frame.extension_install_preview.artifact) : undefined,
      trust: frame.extension_install_preview.trust ? jsonObject(frame.extension_install_preview.trust) : undefined,
      message: frame.extension_install_preview.message ?? '',
    }) } : null;
    case 'extension_install_result': return frame.extension_install_result ? { case: 'extensionInstallResult', value: create(surfaceV1.ExtensionInstallResultEventSchema, {
      requestId: frame.extension_install_result.request_id, status: frame.extension_install_result.status,
      extensionId: frame.extension_install_result.extension_id ?? '', version: frame.extension_install_result.version ?? '',
      alreadyInstalled: frame.extension_install_result.already_installed ?? false,
      message: frame.extension_install_result.message ?? '',
    }) } : null;
    case 'extension_uninstall_result': return frame.extension_uninstall_result ? { case: 'extensionUninstallResult', value: create(surfaceV1.ExtensionUninstallResultEventSchema, {
      requestId: frame.extension_uninstall_result.request_id, extensionId: frame.extension_uninstall_result.extension_id,
      version: frame.extension_uninstall_result.version, status: frame.extension_uninstall_result.status,
      message: frame.extension_uninstall_result.message ?? '',
    }) } : null;
    case 'extension_lifecycle_result': return frame.extension_lifecycle_result ? { case: 'extensionLifecycleResult', value: create(surfaceV1.ExtensionLifecycleResultEventSchema, {
      requestId: frame.extension_lifecycle_result.request_id, extensionId: frame.extension_lifecycle_result.extension_id,
      version: frame.extension_lifecycle_result.version ?? '', operation: frame.extension_lifecycle_result.operation,
      status: frame.extension_lifecycle_result.status, message: frame.extension_lifecycle_result.message ?? '',
    }) } : null;
    case 'extension_command_result': return frame.extension_command_result ? { case: 'extensionCommandResult', value: create(surfaceV1.ExtensionCommandResultEventSchema, {
      requestId: frame.extension_command_result.request_id, commandId: frame.extension_command_result.command_id,
      status: frame.extension_command_result.status,
      result: frame.extension_command_result.result === undefined ? undefined : jsonValue(frame.extension_command_result.result),
      message: frame.extension_command_result.message ?? '',
    }) } : null;
    case 'extension_runtime_projection_result': return frame.extension_runtime_projection_result ? { case: 'extensionRuntimeProjectionResult', value: create(surfaceV1.ExtensionRuntimeProjectionResultEventSchema, {
      requestId: frame.extension_runtime_projection_result.request_id,
      status: frame.extension_runtime_projection_result.status,
      projections: frame.extension_runtime_projection_result.projections.map(jsonObject),
      installations: frame.extension_runtime_projection_result.installations.map(jsonObject),
      message: frame.extension_runtime_projection_result.message ?? '',
    }) } : null;
    case 'extension_runtime_projection_changed': return frame.extension_runtime_projection_changed ? { case: 'extensionRuntimeProjectionChanged', value: create(surfaceV1.ExtensionRuntimeProjectionChangedEventSchema, {
      projection: jsonObject(frame.extension_runtime_projection_changed),
    }) } : null;
    case 'extension_status_changed': return frame.extension_status_changed ? { case: 'extensionStatusChanged', value: create(surfaceV1.ExtensionStatusChangedEventSchema, {
      extensionId: frame.extension_status_changed.extension_id, event: frame.extension_status_changed.event,
      message: frame.extension_status_changed.message ?? '',
    }) } : null;
    case 'core_skill_action_request': return { case: 'coreSkillActionRequest', value: create(surfaceV1.CoreSkillActionRequestEventSchema, {
      requestId: frame.request_id, action: frame.action, payload: jsonObject(frame.payload),
    }) };
    case 'core_skill_confirmation_request': {
      const confirmation = frame.confirmation;
      return confirmation ? { case: 'coreSkillConfirmationRequest', value: create(surfaceV1.CoreSkillConfirmationRequestEventSchema, {
        requestId: frame.request_id, traceId: confirmation.trace_id, skillId: confirmation.skill_id,
        targetKind: confirmation.target_kind, targetName: confirmation.target_name,
        riskLevel: confirmation.risk_level, sideEffects: confirmation.side_effects,
      }) } : null;
    }
    case 'shutdown': return { case: 'shutdown', value: create(surfaceV1.ShutdownEventSchema) };
    default: return null;
  }
}

function audioCapability(value: AudioCapabilityStatus) {
  return create(surfaceV1.AudioCapabilityProjectionSchema, {
    enabled: value.enabled, disabledReason: value.disabled_reason ?? '',
    activeProvider: value.active_provider ?? '', routeState: value.route_state,
    providers: value.providers.map((item) => create(surfaceV1.AudioProviderProjectionSchema, {
      providerId: item.provider_id, role: item.role, execution: item.execution,
      status: item.status, message: item.message ?? '',
    })),
  });
}
