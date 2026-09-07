import type { ConfigurationSnapshot, ConfigurationProviderSnapshot } from '../../../src/shared/control-center-models';
export function configurationScenario(zeroProvider = true): ConfigurationSnapshot {
const providers: ConfigurationProviderSnapshot[] = zeroProvider
    ? []
    : [{
      key: 'primary',
      api_type: 'openai',
      base_url: 'https://api.example.com',
      has_api_key: true,
      models: [{ alias: 'chat', model_id: 'gpt-4.1' }],
    }];
return {
      revision: 'fixture-rev-1',
      llm: {
        provider_count: providers.length,
        providers,
        default_route: zeroProvider
          ? { ready: false, reason: '尚未配置默认对话模型。' }
          : {
            provider_key: 'primary',
            model_alias: 'chat',
            effective_model_id: 'gpt-4.1',
            ready: true,
          },
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
            enabled: true,
            max_age_days: 30,
          },
          providers: {
            'dashscope-cosyvoice': {
              enabled: true,
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
        route: {
          provider: 'dashscope-text-embedding',
        },
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
        config_root: '/fixture/configs',
        data_root: '/fixture/data',
        state_root: '/fixture/data/state',
      },
      service: {
        cognition_ready: true,
        restart_supported: true,
      },
    };
}
