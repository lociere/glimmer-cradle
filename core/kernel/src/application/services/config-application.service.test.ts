import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import yaml from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalConfig } from '../../foundation/config/config-schema';
import { ConfigApplicationService } from './config-application.service';
import type {
  AudioConfig,
  ConfigurationUpdateRequest,
  EmbeddingConfig,
  LLMConfig,
  MemoryConfig,
  SkillPlaneConfig,
} from '@glimmer-cradle/protocol';

const cleanupRoots = new Set<string>();
const envSnapshot = {
  appRoot: process.env.GLIMMER_CRADLE_APP_ROOT,
  configRoot: process.env.GLIMMER_CRADLE_CONFIG_ROOT,
  dataRoot: process.env.GLIMMER_CRADLE_DATA_ROOT,
};

describe('ConfigApplicationService', () => {
  afterEach(async () => {
    restoreEnv('GLIMMER_CRADLE_APP_ROOT', envSnapshot.appRoot);
    restoreEnv('GLIMMER_CRADLE_CONFIG_ROOT', envSnapshot.configRoot);
    restoreEnv('GLIMMER_CRADLE_DATA_ROOT', envSnapshot.dataRoot);
    vi.restoreAllMocks();
    await Promise.all([...cleanupRoots].map(async (root) => {
      cleanupRoots.delete(root);
      await fs.remove(root);
    }));
  });

  it('returns a readable zero-provider snapshot without blocking the control plane', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const service = createService(fixture, { isReady: false });

    const snapshot = await service.getSnapshot();

    expect(snapshot.llm.provider_count).toBe(0);
    expect(snapshot.llm.default_route.ready).toBe(false);
    expect(snapshot.llm.default_route.reason).toContain('尚未配置默认对话模型');
    expect(snapshot.audio.tts.enabled).toBe(false);
    expect(snapshot.embedding.enabled).toBe(false);
    expect(snapshot.skills.user_skills?.enabled).toBe(false);
    expect(snapshot.service.cognition_ready).toBe(false);
    expect(snapshot.storage.config_root).toBe(fixture.configRoot);
  });

  it('previews provider changes through the config owner without persisting secrets', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const service = createService(fixture, { isReady: true });
    const request = createUpdateRequest('rev-preview', fixture.currentConfig.character.llm, 'preview-provider');
    request.revision = (await service.getSnapshot()).revision;

    const result = await service.previewUpdate(request);

    expect(result.status).toBe('preview');
    expect(result.apply_state).toBe('unchanged');
    expect(result.snapshot?.llm.provider_count).toBe(1);
    expect(result.snapshot?.llm.providers[0]).toMatchObject({
      key: 'preview-provider',
      has_api_key: true,
      api_type: 'openai',
    });
    expect(result.change_summary).toEqual(expect.arrayContaining([
      '新增 Provider preview-provider',
      '切换默认路由到 preview-provider/chat',
    ]));

    const persistedProviders = await fs.readFile(fixture.providersPath, 'utf8');
    const persistedSecrets = await fs.readFile(fixture.secretsPath, 'utf8');
    expect(persistedProviders).not.toContain('preview-provider');
    expect(persistedSecrets).not.toContain('preview-secret-key');
  });

  it('applies provider changes atomically and restarts cognition when ready', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const restart = vi.fn(async () => undefined);
    const service = createService(fixture, { isReady: true, restart });
    const request = createUpdateRequest('rev-apply', fixture.currentConfig.character.llm, 'apply-provider');
    request.revision = (await service.getSnapshot()).revision;

    const result = await service.applyUpdate(request);

    expect(result.status).toBe('success');
    expect(result.apply_state).toBe('completed');
    expect(restart).toHaveBeenCalledTimes(1);

    const providersDocument = yaml.parse(await fs.readFile(fixture.providersPath, 'utf8')) as LLMConfig;
    const secretsDocument = yaml.parse(await fs.readFile(fixture.secretsPath, 'utf8')) as {
      providers?: Record<string, { api_key?: string }>;
    };

    expect(providersDocument.default_route).toEqual({
      provider: 'apply-provider',
      model_alias: 'chat',
    });
    expect(providersDocument.models).toEqual({ chat: 'gpt-4.1' });
    expect(providersDocument.providers?.['apply-provider']?.models).toEqual({ chat: 'gpt-4.1' });
    expect(secretsDocument.providers?.['apply-provider']?.api_key).toBe('preview-secret-key');
    expect(result.snapshot?.llm.default_route).toMatchObject({
      provider_key: 'apply-provider',
      model_alias: 'chat',
      effective_model_id: 'gpt-4.1',
      ready: true,
    });
  });

  it('rejects provider tests without an API key and does not touch the network', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    const fetchFn = fetchSpy as unknown as typeof fetch;
    const service = createService(fixture, { isReady: false, fetchFn });

    const result = await service.testProvider({
      request_id: 'provider-test',
      provider: {
        key: 'empty-secret',
        api_type: 'openai',
        base_url: 'https://api.example.test',
      },
    });

    expect(result.status).toBe('error');
    expect(result.message).toContain('尚未填写 API Key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

async function createFixture(llm: LLMConfig): Promise<{
  root: string;
  configRoot: string;
  dataRoot: string;
  stateRoot: string;
  providersPath: string;
  secretsPath: string;
  audioPath: string;
  embeddingPath: string;
  memoryPath: string;
  skillsPath: string;
  currentConfig: GlobalConfig;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-config-service-'));
  cleanupRoots.add(root);
  const configRoot = path.join(root, 'configs');
  const dataRoot = path.join(root, 'data');
  const stateRoot = path.join(dataRoot, 'state');
  const providersPath = path.join(configRoot, 'characters', 'selrena', 'providers.yaml');
  const secretsPath = path.join(configRoot, 'secrets', 'secrets.yaml');
  const audioPath = path.join(configRoot, 'system', 'audio.yaml');
  const embeddingPath = path.join(configRoot, 'system', 'embedding.yaml');
  const memoryPath = path.join(configRoot, 'system', 'memory.yaml');
  const skillsPath = path.join(configRoot, 'system', 'skills.yaml');

  await fs.ensureDir(path.dirname(providersPath));
  await fs.ensureDir(path.dirname(secretsPath));
  await fs.ensureDir(path.dirname(audioPath));
  await fs.ensureDir(stateRoot);
  await fs.writeFile(providersPath, yaml.stringify(llm), 'utf8');
  await fs.writeFile(secretsPath, yaml.stringify({}), 'utf8');
  await fs.writeFile(audioPath, yaml.stringify(defaultAudioConfig()), 'utf8');
  await fs.writeFile(embeddingPath, yaml.stringify(defaultEmbeddingConfig()), 'utf8');
  await fs.writeFile(memoryPath, yaml.stringify(defaultMemoryConfig()), 'utf8');
  await fs.writeFile(skillsPath, yaml.stringify(defaultSkillPlaneConfig()), 'utf8');

  process.env.GLIMMER_CRADLE_APP_ROOT = root;
  process.env.GLIMMER_CRADLE_CONFIG_ROOT = configRoot;
  process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;

  const currentConfig = createGlobalConfig(structuredClone(llm));

  return {
    root,
    configRoot,
    dataRoot,
    stateRoot,
    providersPath,
    secretsPath,
    audioPath,
    embeddingPath,
    memoryPath,
    skillsPath,
    get currentConfig() {
      return currentConfig;
    },
  };
}

function createService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  options: {
    isReady: boolean;
    restart?: () => Promise<void>;
    fetchFn?: typeof fetch;
  },
): ConfigApplicationService {
  return new ConfigApplicationService({
    configRoot: fixture.configRoot,
    dataRoot: fixture.dataRoot,
    stateRoot: fixture.stateRoot,
    fetchFn: options.fetchFn,
    configManager: {
      getConfig: () => fixture.currentConfig,
      reloadConfig: async () => {
        fixture.currentConfig.character.llm = yaml.parse(await fs.readFile(fixture.providersPath, 'utf8')) as LLMConfig;
        fixture.currentConfig.system.audio = yaml.parse(await fs.readFile(fixture.audioPath, 'utf8')) as GlobalConfig['system']['audio'];
        fixture.currentConfig.system.embedding = yaml.parse(await fs.readFile(fixture.embeddingPath, 'utf8')) as GlobalConfig['system']['embedding'];
        fixture.currentConfig.system.memory = yaml.parse(await fs.readFile(fixture.memoryPath, 'utf8')) as GlobalConfig['system']['memory'];
        fixture.currentConfig.system.skill_plane = yaml.parse(await fs.readFile(fixture.skillsPath, 'utf8')) as GlobalConfig['system']['skill_plane'];
      },
    },
    cognition: {
      isReady: options.isReady,
      restart: options.restart ?? (async () => undefined),
    },
  });
}

function createGlobalConfig(initialLlm: LLMConfig): GlobalConfig {
  let llmValue = structuredClone(initialLlm);
  const config = {
    system: {
      identity: {
        app_name: 'Glimmer Cradle',
        app_version: '0.1.1',
      },
      character: {
        active_id: 'selrena',
        profile_root: 'characters',
      },
      backup: {
        enabled: false,
        backup_dir: 'data/backups',
        interval_hours: 0,
      },
      skill_plane: defaultSkillPlaneConfig(),
      audio: defaultAudioConfig(),
      embedding: defaultEmbeddingConfig(),
      memory: defaultMemoryConfig(),
    },
    character: {
      manifest: {} as GlobalConfig['character']['manifest'],
      profile: {} as GlobalConfig['character']['profile'],
      dialogue: {} as GlobalConfig['character']['dialogue'],
      safety: {} as GlobalConfig['character']['safety'],
      inference: {} as GlobalConfig['character']['inference'],
      voice: {} as GlobalConfig['character']['voice'],
      get llm() {
        return llmValue;
      },
      set llm(value: LLMConfig | undefined) {
        if (value) {
          llmValue = value;
        }
      },
    },
  };
  return config as unknown as GlobalConfig;
}

function createUpdateRequest(
  requestId: string,
  currentLlm: LLMConfig | undefined,
  providerKey: string,
): ConfigurationUpdateRequest {
  return {
    request_id: requestId,
    revision: 'stale-revision',
    dry_run: false,
    llm: {
      providers: [{
        key: providerKey,
        api_type: 'openai',
        base_url: 'https://api.example.test',
        api_key: 'preview-secret-key',
        temperature: 0.6,
        models: [{ alias: 'chat', model_id: 'gpt-4.1' }],
      }],
      removed_provider_keys: Object.keys(currentLlm?.providers ?? {}),
      default_route_provider_key: providerKey,
      default_route_model_alias: 'chat',
    },
    audio: defaultAudioConfig(),
    embedding: defaultEmbeddingConfig(),
    memory: defaultMemoryConfig(),
    skills: defaultSkillPlaneConfig(),
  };
}

function defaultAudioConfig(): AudioConfig {
  return {
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
        max_age_days: 7,
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
      resource_id: 'funasr.default',
    },
  };
}

function defaultEmbeddingConfig(): EmbeddingConfig {
  return {
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
  };
}

function defaultMemoryConfig(): MemoryConfig {
  return {
    working: {
      max_messages_per_conversation: 32,
      hydrate_recent_messages: 12,
      context_message_limit: 16,
    },
    conversation: {
      segment_target_messages: 16,
      chapter_idle_minutes: 30,
      chapter_segment_limit: 8,
      state_update_messages: 8,
      history_candidate_limit: 12,
      history_result_limit: 6,
      summary_max_chars: 256,
    },
    experience: {
      enabled: true,
      pack_max_size_mb: 16,
      flush_interval_ms: 1000,
      flush_max_buffer: 8,
      episode_idle_seconds: 60,
      seal_integrity_check: true,
    },
    consolidation: {
      enabled: false,
      batch_size: 8,
      max_batch_moments: 24,
      debounce_seconds: 30,
      max_wait_seconds: 120,
      lease_seconds: 120,
      retry_base_seconds: 30,
      minimum_salience: 0.2,
      autobiographical_evidence_threshold: 3,
      schedule_interval_seconds: 300,
    },
    retrieval: {
      token_budget: 1536,
      candidate_limit: 12,
      result_limit: 6,
      semantic_weight: 0.5,
    },
  };
}

function defaultSkillPlaneConfig(): SkillPlaneConfig {
  return {
    mcp_servers: [],
    user_skills: {
      enabled: false,
      root_dir: 'skills',
    },
  };
}

function restoreEnv(key: 'GLIMMER_CRADLE_APP_ROOT' | 'GLIMMER_CRADLE_CONFIG_ROOT' | 'GLIMMER_CRADLE_DATA_ROOT', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
