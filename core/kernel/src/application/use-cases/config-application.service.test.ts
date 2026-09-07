import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import yaml from 'yaml';
import { createServer } from 'node:http';
import * as observabilityPlane from '../../adapters/observability/plane/plane';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalConfig } from '../../adapters/config/config-schema';
import { ConfigApplicationService } from '../../adapters/config/config-application-adapter';
import type { ConfigurationUpdateRequest } from '../../ports/configuration-models';
import type { AudioConfig, EmbeddingConfig, MemoryConfig, SkillPlaneConfig } from '../../domain/config';
import type { LLMConfig } from '../../adapters/config/documents/LLMConfig';

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
    vi.useRealTimers();
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

  it('applies audio, embedding, memory and skill changes through the same config owner', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const service = createService(fixture, { isReady: true });
    const request = createUpdateRequest('rev-system', fixture.currentConfig.character.llm, 'system-provider');
    request.revision = (await service.getSnapshot()).revision;
    request.audio.tts.enabled = true;
    request.audio.asr.enabled = true;
    request.audio.tts.cache.max_age_days = 14;
    request.embedding.enabled = true;
    request.embedding.route.provider = 'local-sentence-transformers';
    request.embedding.providers['local-sentence-transformers'].auto_download = true;
    request.memory.working.context_message_limit = 12;
    request.memory.experience.enabled = false;
    request.skills.user_skills = {
      enabled: true,
      root_dir: 'skills/local',
    };
    request.skills.mcp_servers = [{
      id: 'ops-maintenance',
      enabled: true,
      products: ['personal-server'],
      transport: 'stdio',
      command: 'pnpm',
      args: ['run', 'mcp'],
      env: {
        MCP_MODE: 'maintenance',
      },
      timeout_ms: 45000,
    }];

    const result = await service.applyUpdate(request);

    expect(result.status).toBe('success');
    expect(result.snapshot?.audio.tts.enabled).toBe(true);
    expect(result.snapshot?.embedding.route.provider).toBe('local-sentence-transformers');
    expect(result.snapshot?.memory.working.context_message_limit).toBe(12);
    expect(result.snapshot?.skills.user_skills?.root_dir).toBe('skills/local');
    expect(result.snapshot?.skills.mcp_servers?.[0]).toMatchObject({
      id: 'ops-maintenance',
      command: 'pnpm',
      timeout_ms: 45000,
    });

    const audioDocument = yaml.parse(await fs.readFile(fixture.audioPath, 'utf8')) as AudioConfig;
    const embeddingDocument = yaml.parse(await fs.readFile(fixture.embeddingPath, 'utf8')) as EmbeddingConfig;
    const memoryDocument = yaml.parse(await fs.readFile(fixture.memoryPath, 'utf8')) as MemoryConfig;
    const skillsDocument = yaml.parse(await fs.readFile(fixture.skillsPath, 'utf8')) as SkillPlaneConfig;

    expect(audioDocument.tts.enabled).toBe(true);
    expect(audioDocument.asr.enabled).toBe(true);
    expect(audioDocument.tts.cache.max_age_days).toBe(14);
    expect(embeddingDocument.enabled).toBe(true);
    expect(embeddingDocument.route.provider).toBe('local-sentence-transformers');
    expect(embeddingDocument.providers['local-sentence-transformers'].auto_download).toBe(true);
    expect(memoryDocument.working.context_message_limit).toBe(12);
    expect(memoryDocument.experience?.enabled).toBe(false);
    expect(skillsDocument.user_skills?.enabled).toBe(true);
    expect(skillsDocument.user_skills?.root_dir).toBe('skills/local');
    expect(skillsDocument.mcp_servers?.[0]).toMatchObject({
      id: 'ops-maintenance',
      command: 'pnpm',
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

  it('tests a saved Provider against a real HTTP endpoint without exposing or rewriting its secret', async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url!);
      expect(request.headers.authorization).toBe('Bearer stored-probe-key');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'chat' }, { id: 'chat' }, { id: 'echo-stored-probe-key' }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('missing port');
      const baseUrl = `http://127.0.0.1:${address.port}/gateway/v1`;
      const fixture = await createFixture({ api_type: 'openai', providers: { primary: { api_type: 'openai', base_url: baseUrl, models: { chat: 'chat' } } } });
      await fs.writeFile(fixture.secretsPath, yaml.stringify({ providers: { primary: { api_key: 'stored-probe-key' } } }));
      const service = createService(fixture, { isReady: false });
      const before = await fs.readFile(fixture.secretsPath, 'utf8');
      const result = await service.testProvider({ request_id: 'saved-test', provider: { key: 'primary', api_type: 'openai', base_url: baseUrl + '/' } });
      expect(result.status).toBe('success');
      expect(result.discovered_models).toEqual(['chat']);
      expect(requests).toEqual(['/gateway/v1/models']);
      expect(JSON.stringify(result)).not.toContain('stored-probe-key');
      expect(await fs.readFile(fixture.secretsPath, 'utf8')).toBe(before);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('never reuses a stored credential for a changed host, path, protocol or cleared secret', async () => {
    const fixture = await createFixture({ api_type: 'openai', providers: { primary: { api_type: 'openai', base_url: 'https://api.example.test/v1', models: { chat: 'chat' } } } });
    await fs.writeFile(fixture.secretsPath, yaml.stringify({ providers: { primary: { api_key: 'stored-probe-key' } } }));
    const fetchFn = vi.fn(async () => Response.json({ data: [] }));
    const service = createService(fixture, { isReady: false, fetchFn });
    for (const change of [{ base_url: 'https://other.example.test/v1' }, { base_url: 'https://api.example.test/other' }, { api_type: 'deepseek' }, { clear_api_key: true }]) {
      const result = await service.testProvider({ request_id: 'changed-test', provider: { key: 'primary', api_type: 'openai', base_url: 'https://api.example.test/v1', ...change } });
      expect(result.status).toBe('error');
      expect(result.message).toContain('重新填写');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps explicit draft credentials local and strips upstream errors from results and audit', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response('echo draft-probe-key', { status: 401 })).mockRejectedValueOnce(new Error('URL draft-probe-key'));
    const service = createService(fixture, { isReady: false, fetchFn });
    const audit = vi.spyOn(observabilityPlane, 'appendAuditRecord');
    const request = { request_id: 'draft-test', provider: { key: 'draft', api_type: 'openai', base_url: 'https://api.example.test', api_key: 'draft-probe-key' } };
    const failure = await service.testProvider(request);
    expect(failure.message).toContain('HTTP 401');
    expect(JSON.stringify(failure)).not.toContain('draft-probe-key');
    expect(JSON.stringify(await service.testProvider(request))).not.toContain('draft-probe-key');
    expect(await fs.readFile(fixture.secretsPath, 'utf8')).not.toContain('draft-probe-key');
    expect(audit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('draft-probe-key');
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer draft-probe-key' } });
  });

  it('does not follow a real HTTP redirect carrying the saved credential', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url!);
      response.writeHead(302, { location: '/destination' }); response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw Error('missing port');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const fixture = await createFixture({ api_type: 'openai', providers: { primary: { api_type: 'openai', base_url: baseUrl, models: { chat: 'chat' } } } });
      await fs.writeFile(fixture.secretsPath, yaml.stringify({ providers: { primary: { api_key: 'stored-probe-key' } } }));
      const result = await createService(fixture, { isReady: false }).testProvider({ request_id: 'redirect-test', provider: { key: 'primary', api_type: 'openai', base_url: baseUrl } });
      expect(result.status).toBe('error'); expect(result.message).toContain('重定向');
      expect(paths).toEqual(['/v1/models']);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('bounds model discovery payloads and rejects credential-bearing or non-HTTP URLs before fetch', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const fetchFn = vi.fn(async () => new Response('x'.repeat(1024 * 1024 + 1)));
    const service = createService(fixture, { isReady: false, fetchFn });
    const provider = { key: 'draft', api_type: 'openai', api_key: 'draft-probe-key', base_url: 'https://api.example.test/v1' };
    for (const base_url of ['file:///secret', 'https://user:pass@api.example.test', 'https://api.example.test?key=secret', 'https://api.example.test/#secret']) {
      expect((await service.testProvider({ request_id: 'invalid-url', provider: { ...provider, base_url } })).status).toBe('error');
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await service.testProvider({ request_id: 'large-body', provider })).status).toBe('error');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled discovery request after 15 seconds and returns a safe timeout', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchFn: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new Error('secret in transport error')), { once: true });
    });
    const service = createService(fixture, { isReady: false, fetchFn });
    const result = service.testProvider({ request_id: 'timeout', provider: { key: 'draft', api_type: 'openai', base_url: 'https://api.example.test', api_key: 'draft-probe-key' } });
    await vi.advanceTimersByTimeAsync(15000);
    expect(signal?.aborted).toBe(true);
    expect((await result).message).toContain('超时');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not copy an invalid Provider identifier into audit records', async () => {
    const fixture = await createFixture({ api_type: 'openai' });
    const audit = vi.spyOn(observabilityPlane, 'appendAuditRecord');
    const fetchFn = vi.fn();
    const result = await createService(fixture, { isReady: false, fetchFn }).testProvider({ request_id: 'invalid-key', provider: { key: 'mistaken-secret\nAuthorization: private', api_type: 'openai' } });
    expect(result.status).toBe('error'); expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.mock.calls)).not.toContain('mistaken-secret');
    expect(audit.mock.calls[0][0].target_name).toBe('invalid-provider');
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
