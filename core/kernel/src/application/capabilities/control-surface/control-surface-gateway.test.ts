import { afterEach, describe, expect, it } from 'vitest';
import { ControlSurfaceGateway } from './control-surface-gateway';
import type { ConfigurationSnapshot, PresentationDownstreamFrame } from '@glimmer-cradle/protocol';
import type { ConversationHistoryService } from './conversation-history-service';

type SkillCatalogSnapshot = NonNullable<NonNullable<PresentationDownstreamFrame['skill_catalog_response']>['snapshot']>;

describe('ControlSurfaceGateway', () => {
  afterEach(() => {
    const gateway = ControlSurfaceGateway.instance as unknown as {
      _configApplicationService: unknown;
      _conversationHistoryService: unknown;
      _clients: Set<unknown>;
    };
    gateway._configApplicationService = null;
    gateway._conversationHistoryService = null;
    gateway._clients.clear();
  });

  it('returns an explicit conversation notice when no usable LLM route is configured', () => {
    const gateway = ControlSurfaceGateway.instance as unknown as {
      _configApplicationService: { hasUsableModelRoute: () => boolean };
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    gateway._configApplicationService = {
      hasUsableModelRoute: () => false,
    };

    gateway._handleMessage({
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
    const gateway = ControlSurfaceGateway.instance as unknown as {
      _conversationHistoryService: Pick<ConversationHistoryService, 'readHistory'>;
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    gateway._conversationHistoryService = {
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

    gateway._handleMessage({
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
    const gateway = ControlSurfaceGateway.instance as unknown as {
      _configApplicationService: { getSnapshot: () => Promise<ConfigurationSnapshot> };
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    gateway._configApplicationService = {
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

    gateway._handleMessage({
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
    const gateway = ControlSurfaceGateway.instance as unknown as {
      _skillCatalogAppService: { getCatalogSnapshot: () => SkillCatalogSnapshot };
      _handleMessage: (data: unknown, ws: unknown) => void;
    };
    const frames: unknown[] = [];
    gateway._skillCatalogAppService = {
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

    gateway._handleMessage({
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
});

function createSocket(frames: unknown[]): { readyState: number; send: (payload: string) => void } {
  return {
    readyState: 1,
    send: (payload: string) => {
      frames.push(JSON.parse(payload));
    },
  };
}
