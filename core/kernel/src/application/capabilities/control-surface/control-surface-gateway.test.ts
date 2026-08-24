import { afterEach, describe, expect, it } from 'vitest';
import { ControlSurfaceGateway } from '../../../adapters/surface/control-surface-gateway';
import type { ConfigurationSnapshot, PresentationDownstreamFrame } from '@glimmer-cradle/extension-sdk';
import type { ConversationHistoryService } from '../../../adapters/surface/conversation-history-service';
import { RecoveryRequiredError } from '../../../domain/errors';
import { RuntimeReadinessProjectionMapper } from '../../projection/runtime-readiness-projection';
import { AvatarController } from '../../../adapters/avatar/avatar-controller';
import { AudioService } from '../../../adapters/audio/audio-service';

type SkillCatalogSnapshot = NonNullable<NonNullable<PresentationDownstreamFrame['skill_catalog_response']>['snapshot']>;
const readinessProjection = new RuntimeReadinessProjectionMapper();
const gateway = new ControlSurfaceGateway(
  readinessProjection,
  new AvatarController(readinessProjection),
  new AudioService(),
);

describe('ControlSurfaceGateway', () => {
  afterEach(() => {
    const subject = gateway as unknown as {
      _configApplicationService: unknown;
      _conversationHistoryService: unknown;
      _clients: Set<unknown>;
      _surfaceSessions: Map<string, unknown>;
      _coreSkillExecutions: Map<string, unknown>;
      _completedCoreSkillExecutions: Map<string, unknown>;
    };
    subject._configApplicationService = null;
    subject._conversationHistoryService = null;
    subject._clients.clear();
    subject._surfaceSessions.clear();
    subject._coreSkillExecutions.clear();
    subject._completedCoreSkillExecutions.clear();
  });

  it('reuses a stable invocation id and does not resend a committed local side effect', async () => {
    const subject = gateway as unknown as {
      _clients: Set<unknown>;
      _handleCoreSkillResponse(data: unknown): void;
      requestCoreSkillAction(action: string, payload: Record<string, unknown>, invocationId?: string): Promise<unknown>;
    };
    const sent: Array<Record<string, unknown>> = [];
    subject._clients.add({
      readyState: 1,
      send(data: string) {
        const frame = JSON.parse(data) as Record<string, unknown>;
        sent.push(frame);
        queueMicrotask(() => subject._handleCoreSkillResponse({
          kind: 'core_skill_action_response',
          request_id: frame.request_id,
          status: 'success',
          result: { ok: true },
        }));
      },
    });

    await expect(subject.requestCoreSkillAction(
      'clipboard.write', { text: 'once' }, 'action:1:tool:0',
    )).resolves.toEqual({ ok: true });
    await expect(subject.requestCoreSkillAction(
      'clipboard.write', { text: 'once' }, 'action:1:tool:0',
    )).resolves.toEqual({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].request_id).toBe('action:1:tool:0');
  });

  it('maps a Desktop manual-recovery projection to a programmatic terminal error', async () => {
    const subject = gateway as unknown as {
      _clients: Set<unknown>;
      _handleCoreSkillResponse(data: unknown): void;
      requestCoreSkillAction(action: string, payload: Record<string, unknown>, invocationId?: string): Promise<unknown>;
    };
    subject._clients.add({
      readyState: 1,
      send(data: string) {
        const frame = JSON.parse(data) as Record<string, unknown>;
        queueMicrotask(() => subject._handleCoreSkillResponse({
          kind: 'core_skill_action_response',
          request_id: frame.request_id,
          status: 'error',
          message: 'arbitrary localized text',
          error_code: 'recovery_required',
          operation_id: frame.request_id,
          recovery_actions: ['confirm_side_effect_state'],
        }));
      },
    });

    const error = await subject.requestCoreSkillAction(
      'clipboard.write', { text: 'uncertain' }, 'action:unsafe:tool:0',
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RecoveryRequiredError);
    expect(error).toMatchObject({
      code: 'recovery_required',
      operationId: 'action:unsafe:tool:0',
      recoveryActions: ['confirm_side_effect_state'],
    });
  });

  it('returns an explicit conversation notice when no usable LLM route is configured', () => {
    const subject = gateway as unknown as {
      _configApplicationService: { hasUsableModelRoute: () => boolean };
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    subject._configApplicationService = {
      hasUsableModelRoute: () => false,
    };

    subject._handleMessage({
      kind: 'chat_input',
      trace_id: 'trace-no-llm',
      chat_input: { text: '你好' },
    }, createSocket(frames));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'conversation_notice',
      trace_id: 'trace-no-llm',
      conversation_notice: {
        code: 'llm_unconfigured',
        action_route: 'settings',
      },
    });
  });

  it('serves conversation history through the control surface protocol', async () => {
    const subject = gateway as unknown as {
      _conversationHistoryService: Pick<ConversationHistoryService, 'readHistory'>;
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    subject._conversationHistoryService = {
      readHistory: async (request) => ({
        request_id: request.request_id,
        status: 'success',
        conversation: {
          source_provider_id: 'desktop-ui',
          scene_id: 'scene:desktop',
          conversation_id: 'conversation:desktop',
          thread_id: 'main',
          recall_scope: 'conversation_private',
          disclosure_scope: 'conversation_private',
        },
        items: [{
          entry_id: 'entry-1',
          source_kind: 'conversation',
          role: 'assistant',
          status: 'committed',
          text: '历史回复',
          occurred_at: '2026-07-18T10:00:00.000Z',
          conversation_id: 'conversation:desktop',
          scene_id: 'scene:desktop',
          thread_id: 'main',
          recall_scope: 'conversation_private',
          disclosure_scope: 'conversation_private',
        }],
        has_more: false,
      }),
    };

    subject._handleMessage({
      kind: 'conversation_history_request',
      conversation_history_request: { request_id: 'history-1', limit: 20 },
    }, createSocket(frames));
    await Promise.resolve();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'conversation_history_result',
      conversation_history_result: {
        request_id: 'history-1',
        status: 'success',
        items: [{ entry_id: 'entry-1', text: '历史回复' }],
        has_more: false,
      },
    });
  });

  it('serves configuration snapshots through the control surface protocol', async () => {
    const subject = gateway as unknown as {
      _configApplicationService: { getSnapshot: () => Promise<ConfigurationSnapshot> };
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    subject._configApplicationService = {
      getSnapshot: async () => ({
        revision: 'snapshot-1',
        llm: {
          provider_count: 0,
          providers: [],
          default_route: { ready: false, reason: '尚未配置默认对话模型。' },
        },
        audio: {
          tts: {
            enabled: false,
            route: {
              primary: 'dashscope-cosyvoice',
              fallbacks: [],
              circuit_breaker: {
                failure_threshold: 3,
                recovery_timeout_ms: 30000,
              },
            },
            cache: {
              enabled: false,
              max_age_days: 30,
            },
            providers: {
              'dashscope-cosyvoice': {
                enabled: false,
                endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
                model: 'cosyvoice-v3.5-flash',
                format: 'wav',
                sample_rate: 24000,
                connect_timeout_ms: 5000,
                receive_timeout_ms: 20000,
                max_retries: 1,
              },
            },
          },
          asr: {
            enabled: false,
            provider: 'funasr',
            resource_id: 'funasr.sensevoice-small',
          },
        },
        embedding: {
          enabled: false,
          route: { provider: 'dashscope-text-embedding' },
          providers: {
            'dashscope-text-embedding': {
              endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
              model: 'text-embedding-v4',
              dimensions: 1024,
              request_timeout_ms: 15000,
              max_retries: 1,
            },
            'local-sentence-transformers': {
              model_path: 'embedding/m3e-small',
              model_id: 'moka-ai/m3e-small',
              auto_download: false,
              device: 'cpu',
              batch_size: 64,
            },
          },
        },
        memory: {
          working: {
            max_messages_per_conversation: 32,
            hydrate_recent_messages: 32,
            context_message_limit: 8,
          },
          conversation: {
            segment_target_messages: 20,
            chapter_idle_minutes: 360,
            chapter_segment_limit: 8,
            state_update_messages: 6,
            history_candidate_limit: 12,
            history_result_limit: 4,
            summary_max_chars: 2400,
          },
          experience: {
            enabled: true,
            pack_max_size_mb: 256,
            flush_interval_ms: 500,
            flush_max_buffer: 64,
            episode_idle_seconds: 300,
            seal_integrity_check: true,
          },
          consolidation: {
            enabled: true,
            batch_size: 8,
            max_batch_moments: 64,
            debounce_seconds: 120,
            max_wait_seconds: 900,
            lease_seconds: 180,
            retry_base_seconds: 30,
            minimum_salience: 0.45,
            autobiographical_evidence_threshold: 3,
            schedule_interval_seconds: 300,
          },
          retrieval: {
            token_budget: 800,
            candidate_limit: 24,
            result_limit: 6,
            semantic_weight: 0.35,
          },
        },
        skills: {
          mcp_servers: [],
          user_skills: {
            enabled: false,
            root_dir: 'skills',
          },
        },
        storage: {
          config_root: 'C:/tmp/configs',
          data_root: 'C:/tmp/data',
          state_root: 'C:/tmp/data/state',
        },
        service: {
          cognition_ready: false,
          restart_supported: true,
        },
      }),
    };

    subject._handleMessage({
      kind: 'config_snapshot_request',
      config_snapshot_request: { request_id: 'config-snapshot-1' },
    }, createSocket(frames));
    await Promise.resolve();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'configuration_snapshot_result',
      configuration_snapshot_result: {
        request_id: 'config-snapshot-1',
        status: 'success',
        snapshot: {
          revision: 'snapshot-1',
        },
      },
    });
  });

  it('serves skill catalog snapshots through the formal presentation payload', () => {
    const subject = gateway as unknown as {
      _skillCatalogAppService: { getCatalogSnapshot: () => SkillCatalogSnapshot };
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    subject._skillCatalogAppService = {
      getCatalogSnapshot: () => ({
        generatedAt: '2026-07-18T18:06:00.000Z',
        totalSkills: 1,
        providerCounts: { core: 1, extension: 0, mcp_server: 0, user: 0 },
        runtimeStatusCounts: { ready: 1, contract_only: 0 },
        totalTools: 1,
        totalResources: 0,
        totalPrompts: 0,
        providerRuntimes: [{
          provider: { kind: 'core', id: 'kernel' },
          display_name: 'Kernel Core Skills',
          state: 'ready',
          summary: '内建 Skills 已就绪。',
          skill_count: 1,
          tool_count: 1,
          resource_count: 0,
          prompt_count: 0,
          recovery_actions: [],
          metadata: {},
          updated_at: '2026-07-18T18:06:00.000Z',
        }],
        entries: [{
          id: 'core.system.status',
          name: '系统状态',
          description: '读取系统状态。',
          audience: 'user',
          scope: { kind: 'global' },
          provider: { kind: 'core', id: 'kernel' },
          tools: [{
            name: 'status.read',
            description: '读取状态',
            audience: 'user',
            scope: { kind: 'global' },
          }],
          resources: [],
          prompts: [],
          policy: {
            riskLevel: 'low',
            confirmationRequired: false,
            sideEffects: [],
            audit: true,
          },
          metadata: { runtime_status: 'ready' },
        }],
      }),
    };

    subject._handleMessage({
      kind: 'skill_catalog_request',
      skill_catalog_request: { request_id: 'skill-catalog-1' },
    }, createSocket(frames));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'skill_catalog_response',
      skill_catalog_response: {
        request_id: 'skill-catalog-1',
        status: 'success',
        snapshot: {
          totalSkills: 1,
          entries: [{ id: 'core.system.status' }],
        },
      },
    });
    expect(frames[0]).not.toHaveProperty('request_id');
    expect(frames[0]).not.toHaveProperty('skill_catalog');
  });

  it('broadcasts synthesized reply audio as a media reference instead of inline data', async () => {
    const subject = gateway as unknown as {
      _clients: Set<unknown>;
      audio: { synthesizeSpeech: (request: { text: string; trace_id: string }) => Promise<unknown> };
      _synthesizeAndBroadcastAudio(traceId: string, text: string, sequence?: number): Promise<void>;
    };
    const frames: unknown[] = [];
    subject._clients.add(createSocket(frames));
    const synthesizeSpeech = subject.audio.synthesizeSpeech;
    subject.audio.synthesizeSpeech = async () => ({
      status: 'success',
      output_path: 'D:/tmp/glimmer-cradle/audio/tts/reply.wav',
    });
    try {
      await subject._synthesizeAndBroadcastAudio('trace-audio-ref', '你好', 0);
    } finally {
      subject.audio.synthesizeSpeech = synthesizeSpeech;
    }

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      kind: 'audio_play',
      trace_id: 'trace-audio-ref',
      audio_play: {
        audio_id: 'reply-trace-audio-ref-0',
        audio_uri: 'file:///D:/tmp/glimmer-cradle/audio/tts/reply.wav',
        mime_type: 'audio/wav',
      },
    });
    expect((frames[0] as { audio_play?: { audio_data?: unknown } }).audio_play).not.toHaveProperty('audio_data');
  });

  it('rejects Query requests whose declared operation does not match frame.kind', async () => {
    const subject = gateway as unknown as {
      _surfaceSessions: Map<string, { productId: string; scopes: Set<string> }>;
      _dispatchSurfaceRpc(
        sessionId: string,
        requiredScope: 'surface:read' | 'surface:write',
        declaredOperation: string,
        rawArguments: Record<string, unknown>,
        callback: (error: Error | null, response: unknown) => void,
        operation: 'query' | 'command',
      ): Promise<void>;
      _configApplicationService: { hasUsableModelRoute: () => boolean };
    };
    subject._surfaceSessions.set('read-session', { productId: 'desktop', scopes: new Set(['surface:read']) });
    subject._configApplicationService = { hasUsableModelRoute: () => true };
    const response = await dispatchSurfaceRpc(subject, {
      sessionId: 'read-session',
      requiredScope: 'surface:read',
      declaredOperation: 'config_snapshot_request',
      rawArguments: { frame: { kind: 'chat_input', chat_input: { text: 'must not dispatch' } } },
      operation: 'query',
    });

    expect(response).toMatchObject({
      status: 'error',
      error: {
        safeMessage: 'Surface Gateway operation 与 frame.kind 不一致',
      },
    });
  });

  it('rejects command-shaped frames sent through the read-only Query RPC', async () => {
    const subject = gateway as unknown as {
      _surfaceSessions: Map<string, { productId: string; scopes: Set<string> }>;
      _dispatchSurfaceRpc(
        sessionId: string,
        requiredScope: 'surface:read' | 'surface:write',
        declaredOperation: string,
        rawArguments: Record<string, unknown>,
        callback: (error: Error | null, response: unknown) => void,
        operation: 'query' | 'command',
      ): Promise<void>;
      _conversationHistoryService: { recordSubmittedUserMessage: (text: string, traceId: string) => void };
      _configApplicationService: { hasUsableModelRoute: () => boolean };
    };
    const submitted: string[] = [];
    subject._surfaceSessions.set('read-session', { productId: 'desktop', scopes: new Set(['surface:read']) });
    subject._configApplicationService = { hasUsableModelRoute: () => true };
    subject._conversationHistoryService = {
      recordSubmittedUserMessage: (text) => submitted.push(text),
    };
    const response = await dispatchSurfaceRpc(subject, {
      sessionId: 'read-session',
      requiredScope: 'surface:read',
      declaredOperation: 'chat_input',
      rawArguments: { frame: { kind: 'chat_input', chat_input: { text: 'must not dispatch' } } },
      operation: 'query',
    });

    expect(response).toMatchObject({
      status: 'error',
      error: {
        safeMessage: 'Surface Gateway query 不支持 chat_input',
      },
    });
    expect(submitted).toEqual([]);
  });
});

function createSocket(frames: unknown[]): { readyState: number; send: (payload: string) => void } {
  return {
    readyState: 1,
    send: (payload: string) => {
      frames.push(JSON.parse(payload));
    },
  };
}

function dispatchSurfaceRpc(
  subject: {
    _dispatchSurfaceRpc(
      sessionId: string,
      requiredScope: 'surface:read' | 'surface:write',
      declaredOperation: string,
      rawArguments: Record<string, unknown>,
      callback: (error: Error | null, response: unknown) => void,
      operation: 'query' | 'command',
    ): Promise<void>;
  },
  input: {
    sessionId: string;
    requiredScope: 'surface:read' | 'surface:write';
    declaredOperation: string;
    rawArguments: Record<string, unknown>;
    operation: 'query' | 'command';
  },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    void subject._dispatchSurfaceRpc(
      input.sessionId,
      input.requiredScope,
      input.declaredOperation,
      input.rawArguments,
      (error, response) => error ? reject(error) : resolve(response),
      input.operation,
    );
  });
}
