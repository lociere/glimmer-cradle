import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import yaml from 'yaml';
import {
  appendAuditRecord,
} from '../../foundation/observability/plane';
import {
  resolveConfigDir,
  resolveDataDir,
  resolveStateDir,
} from '../../foundation/utils/path-utils';
import type { GlobalConfig } from '../../foundation/config/config-schema';
import {
  type AudioConfig,
  validateConfig,
  type EmbeddingConfig,
  type ConfigurationModelAlias,
  type ConfigurationProviderDraft,
  type ConfigurationProviderTestDraft,
  type ConfigurationProviderSnapshot,
  type ConfigurationRouteSnapshot,
  type ConfigurationSnapshot,
  type ConfigurationTestRequest,
  type ConfigurationTestResult,
  type ConfigurationUpdateRequest,
  type ConfigurationUpdateResult,
  type LLMConfig,
  type MemoryConfig,
  type SkillPlaneConfig,
} from '@glimmer-cradle/protocol';

interface ConfigManagerPort {
  getConfig(): Readonly<GlobalConfig>;
  reloadConfig(): Promise<void>;
}

interface CognitionControlPort {
  readonly isReady: boolean;
  restart(): Promise<void>;
}

interface ConfigApplicationServiceOptions {
  readonly configManager: ConfigManagerPort;
  readonly cognition: CognitionControlPort;
  readonly fetchFn?: typeof fetch;
  readonly configRoot?: string;
  readonly dataRoot?: string;
  readonly stateRoot?: string;
}

interface ProviderSecretRecord {
  api_key?: string;
}

interface SecretsDocument {
  providers?: Record<string, ProviderSecretRecord>;
  [key: string]: unknown;
}

type MutableLLMConfig = LLMConfig & {
  providers?: Record<string, NonNullable<LLMConfig['providers']>[string]>;
};

interface NormalizedProviderDraft extends Omit<ConfigurationProviderDraft, 'models'> {
  models: ConfigurationModelAlias[];
}

type NormalizedProviderTestDraft = Omit<ConfigurationProviderTestDraft, 'api_key'> & {
  api_key?: string;
};

interface ConfigDocumentBundle {
  readonly providersPath: string;
  readonly secretsPath: string;
  readonly audioPath: string;
  readonly embeddingPath: string;
  readonly memoryPath: string;
  readonly skillsPath: string;
  readonly llm: MutableLLMConfig;
  readonly secrets: SecretsDocument;
  readonly audio: AudioConfig;
  readonly embedding: EmbeddingConfig;
  readonly memory: MemoryConfig;
  readonly skills: SkillPlaneConfig;
  readonly revision: string;
}

const MODULE_NAME = 'config-application-service';

export class ConfigApplicationService {
  private readonly fetchFn: typeof fetch;
  private readonly configRoot: string;
  private readonly dataRoot: string;
  private readonly stateRoot: string;
  private applyQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: ConfigApplicationServiceOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.configRoot = options.configRoot ?? resolveConfigDir();
    this.dataRoot = options.dataRoot ?? resolveDataDir();
    this.stateRoot = options.stateRoot ?? resolveStateDir();
  }

  public async getSnapshot(): Promise<ConfigurationSnapshot> {
    const config = this.options.configManager.getConfig();
    const documents = await this.loadDocuments(config);
    return this.buildSnapshot(config, documents, documents.revision);
  }

  public async previewUpdate(request: ConfigurationUpdateRequest): Promise<ConfigurationUpdateResult> {
    return this.previewOrApplyUpdate(request, true);
  }

  public async applyUpdate(request: ConfigurationUpdateRequest): Promise<ConfigurationUpdateResult> {
    return this.runExclusiveApply(() => this.previewOrApplyUpdate(request, false));
  }

  public async testProvider(request: ConfigurationTestRequest): Promise<ConfigurationTestResult> {
    const startedAt = Date.now();
    const provider = normalizeProviderTestDraft(request.provider);
    const validationError = validateProviderTestDraft(provider);
    if (validationError) {
      return {
        request_id: request.request_id,
        status: 'error',
        message: validationError,
        discovered_models: [],
      };
    }
    const apiKey = provider.api_key?.trim();
    if (!apiKey) {
      return {
        request_id: request.request_id,
        status: 'error',
        message: '尚未填写 API Key，无法测试连接。',
        discovered_models: [],
      };
    }

    const apiType = provider.api_type.trim().toLowerCase();
    if (apiType !== 'openai' && apiType !== 'deepseek') {
      return {
        request_id: request.request_id,
        status: 'error',
        message: `当前仅支持 OpenAI/DeepSeek 兼容 Provider 的模型发现，${provider.api_type} 请手动填写模型。`,
        discovered_models: [],
      };
    }

    const baseUrl = provider.base_url?.trim();
    if (!baseUrl) {
      return {
        request_id: request.request_id,
        status: 'error',
        message: '缺少 base_url，无法测试连接。',
        discovered_models: [],
      };
    }

    try {
      const endpoint = new URL('/v1/models', ensureTrailingSlash(baseUrl)).toString();
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });
      if (!response.ok) {
        const body = await safeReadResponseText(response);
        return {
          request_id: request.request_id,
          status: 'error',
          message: `连接失败：${response.status}${body ? ` ${body}` : ''}`,
          discovered_models: [],
          latency_ms: Date.now() - startedAt,
        };
      }
      const payload = await response.json() as { data?: Array<{ id?: unknown }> };
      const discoveredModels = Array.isArray(payload?.data)
        ? payload.data
          .map((item) => typeof item?.id === 'string' ? item.id.trim() : '')
          .filter(Boolean)
        : [];
      appendAuditRecord({
        owner: 'configuration',
        module: MODULE_NAME,
        action: 'provider.test',
        target_kind: 'llm_provider',
        target_name: provider.key,
        outcome: 'succeeded',
        attributes: {
          discovered_model_count: discoveredModels.length,
          api_type: provider.api_type,
        },
      });
      return {
        request_id: request.request_id,
        status: 'success',
        message: discoveredModels.length > 0
          ? `连接成功，发现 ${discoveredModels.length} 个模型。`
          : '连接成功，但 Provider 未返回模型列表，请手动填写模型。',
        discovered_models: discoveredModels,
        latency_ms: Date.now() - startedAt,
      };
    } catch (error) {
      appendAuditRecord({
        owner: 'configuration',
        module: MODULE_NAME,
        action: 'provider.test',
        target_kind: 'llm_provider',
        target_name: provider.key,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
      return {
        request_id: request.request_id,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        discovered_models: [],
        latency_ms: Date.now() - startedAt,
      };
    }
  }

  public hasUsableModelRoute(): boolean {
    const llm = this.options.configManager.getConfig().character.llm;
    if (!llm) return false;
    const rootModel = firstModelEntry(llm.models);
    return Boolean(llm.api_key?.trim() && rootModel?.model_id);
  }

  private async previewOrApplyUpdate(
    request: ConfigurationUpdateRequest,
    dryRunOverride: boolean,
  ): Promise<ConfigurationUpdateResult> {
    const config = this.options.configManager.getConfig();
    const current = await this.loadDocuments(config);
    if (current.revision !== request.revision) {
      return {
        request_id: request.request_id,
        status: 'conflict',
        apply_state: 'unchanged',
        change_summary: [],
        snapshot: this.buildSnapshot(config, current, current.revision),
        message: '配置已被其他会话更新，请先刷新后再保存。',
      };
    }

    let next: ConfigDocumentBundle;
    try {
      next = this.buildNextDocuments(current, request);
    } catch (error) {
      return {
        request_id: request.request_id,
        status: 'error',
        apply_state: 'unchanged',
        change_summary: [],
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const nextRevision = computeRevision(next);
    const changeSummary = summarizeChanges(current, next);
    const nextSnapshot = this.buildSnapshot(config, next, nextRevision);
    const dryRun = dryRunOverride || request.dry_run === true;

    if (dryRun) {
      appendAuditRecord({
        owner: 'configuration',
        module: MODULE_NAME,
        action: 'config.preview',
        target_kind: 'llm_configuration',
        outcome: 'succeeded',
        attributes: {
          change_count: changeSummary.length,
        },
      });
      return {
        request_id: request.request_id,
        status: 'preview',
        apply_state: 'unchanged',
        change_summary: changeSummary,
        new_revision: nextRevision,
        snapshot: nextSnapshot,
      };
    }

    await this.writeDocumentsAtomically(next);

    let status: ConfigurationUpdateResult['status'] = 'success';
    let applyState: ConfigurationUpdateResult['apply_state'] = 'restart_required';
    let message: string | undefined;

    try {
      await this.options.configManager.reloadConfig();
      if (this.options.cognition.isReady) {
        applyState = 'restarting';
        await this.options.cognition.restart();
        applyState = 'completed';
      }
    } catch (error) {
      applyState = 'failed';
      message = error instanceof Error ? error.message : String(error);
    }

    appendAuditRecord({
      owner: 'configuration',
      module: MODULE_NAME,
      action: 'config.apply',
      target_kind: 'llm_configuration',
      outcome: applyState === 'failed' ? 'failed' : 'succeeded',
      reason: message ?? null,
      attributes: {
        change_count: changeSummary.length,
        revision: nextRevision,
        apply_state: applyState,
      },
    });

    const reloadedConfig = this.options.configManager.getConfig();
    const refreshedDocuments = await this.loadDocuments(reloadedConfig);
    return {
      request_id: request.request_id,
      status,
      apply_state: applyState,
      change_summary: changeSummary,
      new_revision: refreshedDocuments.revision,
      snapshot: this.buildSnapshot(
        reloadedConfig,
        refreshedDocuments,
        refreshedDocuments.revision,
      ),
      message,
    };
  }

  private runExclusiveApply<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.applyQueue.then(operation);
    this.applyQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async loadDocuments(config: Readonly<GlobalConfig>): Promise<ConfigDocumentBundle> {
    const characterSelection = resolveActiveCharacter(config);
    const providersPath = path.join(this.configRoot, characterSelection.root, characterSelection.id, 'providers.yaml');
    const secretsPath = path.join(this.configRoot, 'secrets', 'secrets.yaml');
    const audioPath = path.join(this.configRoot, 'system', 'audio.yaml');
    const embeddingPath = path.join(this.configRoot, 'system', 'embedding.yaml');
    const memoryPath = path.join(this.configRoot, 'system', 'memory.yaml');
    const skillsPath = path.join(this.configRoot, 'system', 'skills.yaml');
    const llm = await readValidatedYamlFile<MutableLLMConfig>('LLMConfig', providersPath);
    const secrets = await readYamlFile<SecretsDocument>(secretsPath, {});
    const audio = await readValidatedYamlFile<AudioConfig>('AudioConfig', audioPath);
    const embedding = await readValidatedYamlFile<EmbeddingConfig>('EmbeddingConfig', embeddingPath);
    const memory = await readValidatedYamlFile<MemoryConfig>('MemoryConfig', memoryPath);
    const skills = await readValidatedYamlFile<SkillPlaneConfig>('SkillPlaneConfig', skillsPath);
    return {
      providersPath,
      secretsPath,
      audioPath,
      embeddingPath,
      memoryPath,
      skillsPath,
      llm,
      secrets,
      audio,
      embedding,
      memory,
      skills,
      revision: computeRevision({ llm, secrets, audio, embedding, memory, skills }),
    };
  }

  private buildSnapshot(
    config: Readonly<GlobalConfig>,
    documents: ConfigDocumentBundle,
    revision: string,
  ): ConfigurationSnapshot {
    const defaultRoute = resolveDefaultRoute(documents.llm, documents.secrets);
    const providers = Object.entries(documents.llm.providers ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, provider]) => ({
        key,
        api_type: provider.api_type ?? 'openai',
        base_url: provider.base_url,
        has_api_key: Boolean(documents.secrets.providers?.[key]?.api_key?.trim()),
        temperature: provider.temperature,
        request_method: provider.request_method,
        request_path: provider.request_path,
        response_extract: provider.response_extract,
        models: modelEntries(provider.models),
      } satisfies ConfigurationProviderSnapshot));

    return {
      revision,
      llm: {
        provider_count: providers.length,
        providers,
        default_route: defaultRoute,
      },
      audio: deepClone(documents.audio),
      embedding: deepClone(documents.embedding),
      memory: deepClone(documents.memory),
      skills: deepClone(documents.skills),
      storage: {
        config_root: this.configRoot,
        data_root: this.dataRoot,
        state_root: this.stateRoot,
      },
      service: {
        cognition_ready: this.options.cognition.isReady,
        restart_supported: true,
      },
    };
  }

  private buildNextDocuments(
    current: ConfigDocumentBundle,
    request: ConfigurationUpdateRequest,
  ): ConfigDocumentBundle {
    const nextProviders = new Map<string, NormalizedProviderDraft>();
    for (const provider of request.llm.providers) {
      const normalized = normalizeProviderDraft(provider);
      const validationError = validateProviderDraft(normalized);
      if (validationError) {
        throw new Error(validationError);
      }
      nextProviders.set(normalized.key, normalized);
    }

    for (const providerKey of request.llm.removed_provider_keys) {
      nextProviders.delete(providerKey);
    }

    const llm: MutableLLMConfig = { api_type: 'openai' };
    if (nextProviders.size > 0) {
      llm.providers = {};
      for (const [key, provider] of [...nextProviders.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        llm.providers[key] = {
          api_type: provider.api_type,
          base_url: provider.base_url || undefined,
          temperature: provider.temperature,
          request_method: provider.request_method,
          request_path: provider.request_path,
          request_headers: provider.request_headers && Object.keys(provider.request_headers).length > 0
            ? provider.request_headers
            : undefined,
          request_body_template: provider.request_body_template || undefined,
          response_extract: provider.response_extract || undefined,
          models: Object.fromEntries(provider.models.map((model) => [model.alias, model.model_id])),
        };
      }
    }

    const selectedProviderKey = request.llm.default_route_provider_key?.trim();
    const selectedModelAlias = request.llm.default_route_model_alias?.trim();
    if (selectedProviderKey && selectedModelAlias) {
      const provider = nextProviders.get(selectedProviderKey);
      if (!provider) {
        throw new Error(`默认路由引用了不存在的 provider: ${selectedProviderKey}`);
      }
      const selectedModel = provider.models.find((model) => model.alias === selectedModelAlias);
      if (!selectedModel) {
        throw new Error(`默认路由引用了不存在的模型别名: ${selectedProviderKey}/${selectedModelAlias}`);
      }
      llm.default_route = {
        provider: selectedProviderKey,
        model_alias: selectedModelAlias,
      };
      llm.api_type = provider.api_type;
      llm.base_url = provider.base_url || undefined;
      llm.temperature = provider.temperature;
      llm.request_method = provider.request_method;
      llm.request_path = provider.request_path;
      llm.request_headers = provider.request_headers && Object.keys(provider.request_headers).length > 0
        ? provider.request_headers
        : undefined;
      llm.request_body_template = provider.request_body_template || undefined;
      llm.response_extract = provider.response_extract || undefined;
      llm.models = { [selectedModel.alias]: selectedModel.model_id };
    }

    const secrets: SecretsDocument = deepClone(current.secrets);
    const providerSecrets = { ...(secrets.providers ?? {}) };
    for (const providerKey of request.llm.removed_provider_keys) {
      delete providerSecrets[providerKey];
    }
    for (const provider of nextProviders.values()) {
      const nextSecret = providerSecrets[provider.key] ?? {};
      const suppliedApiKey = provider.api_key?.trim();
      if (suppliedApiKey) {
        providerSecrets[provider.key] = { ...nextSecret, api_key: suppliedApiKey };
      } else if (provider.clear_api_key) {
        delete providerSecrets[provider.key];
      } else if (nextSecret.api_key) {
        providerSecrets[provider.key] = nextSecret;
      }
    }
    if (Object.keys(providerSecrets).length > 0) {
      secrets.providers = providerSecrets;
    } else {
      delete secrets.providers;
    }

    const audio = validateOrThrow<AudioConfig>('AudioConfig', request.audio);
    const embedding = validateOrThrow<EmbeddingConfig>('EmbeddingConfig', request.embedding);
    const memory = validateOrThrow<MemoryConfig>('MemoryConfig', request.memory);
    const skills = validateOrThrow<SkillPlaneConfig>('SkillPlaneConfig', request.skills);

    return {
      providersPath: current.providersPath,
      secretsPath: current.secretsPath,
      audioPath: current.audioPath,
      embeddingPath: current.embeddingPath,
      memoryPath: current.memoryPath,
      skillsPath: current.skillsPath,
      llm,
      secrets,
      audio,
      embedding,
      memory,
      skills,
      revision: computeRevision({ llm, secrets, audio, embedding, memory, skills }),
    };
  }

  private async writeDocumentsAtomically(
    documents: ConfigDocumentBundle,
  ): Promise<void> {
    const writes = [
      { path: documents.providersPath, content: yaml.stringify(documents.llm) },
      { path: documents.secretsPath, content: yaml.stringify(documents.secrets) },
      { path: documents.audioPath, content: yaml.stringify(documents.audio) },
      { path: documents.embeddingPath, content: yaml.stringify(documents.embedding) },
      { path: documents.memoryPath, content: yaml.stringify(documents.memory) },
      { path: documents.skillsPath, content: yaml.stringify(documents.skills) },
    ] as const;
    const backups = new Map<string, { existed: true; content: string } | { existed: false }>();
    const temporaryPaths = new Map<string, string>();

    for (const write of writes) {
      await fs.ensureDir(path.dirname(write.path));
      backups.set(write.path, await readRollbackSnapshot(write.path));
      const temporaryPath = `${write.path}.${process.pid}.${randomUUID()}.tmp`;
      temporaryPaths.set(write.path, temporaryPath);
      await fs.writeFile(temporaryPath, write.content, 'utf8');
    }

    try {
      for (const write of writes) {
        await fs.move(temporaryPaths.get(write.path)!, write.path, { overwrite: true });
      }
    } catch (error) {
      for (const write of writes) {
        const backup = backups.get(write.path);
        if (!backup) continue;
        if (backup.existed) {
          await fs.writeFile(write.path, backup.content, 'utf8').catch(() => undefined);
        } else {
          await fs.remove(write.path).catch(() => undefined);
        }
      }
      throw error;
    } finally {
      for (const temporaryPath of temporaryPaths.values()) {
        await fs.remove(temporaryPath).catch(() => undefined);
      }
    }
  }
}

async function readRollbackSnapshot(filePath: string): Promise<{ existed: true; content: string } | { existed: false }> {
  try {
    return {
      existed: true,
      content: await fs.readFile(filePath, 'utf8'),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { existed: false };
    }
    throw error;
  }
}

function resolveActiveCharacter(config: Readonly<GlobalConfig>): { id: string; root: string } {
  const activeId = config.system.character.active_id;
  const profileRoot = config.system.character.profile_root;
  return {
    id: activeId,
    root: profileRoot,
  };
}

function normalizeProviderDraft(provider: ConfigurationProviderDraft): NormalizedProviderDraft {
  return {
    ...provider,
    key: provider.key.trim(),
    api_type: provider.api_type.trim(),
    base_url: provider.base_url?.trim() || undefined,
    api_key: provider.api_key?.trim() || undefined,
    request_path: provider.request_path?.trim() || undefined,
    request_body_template: provider.request_body_template || undefined,
    response_extract: provider.response_extract?.trim() || undefined,
    models: provider.models
      .map((model) => ({ alias: model.alias.trim(), model_id: model.model_id.trim() }))
      .filter((model) => model.alias && model.model_id),
  };
}

function normalizeProviderTestDraft(provider: ConfigurationProviderTestDraft): NormalizedProviderTestDraft {
  return {
    ...provider,
    key: provider.key.trim(),
    api_type: provider.api_type.trim(),
    base_url: provider.base_url?.trim() || undefined,
    api_key: provider.api_key?.trim() || undefined,
    request_path: provider.request_path?.trim() || undefined,
    request_body_template: provider.request_body_template || undefined,
    response_extract: provider.response_extract?.trim() || undefined,
  };
}

function validateProviderDraft(provider: NormalizedProviderDraft): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.key)) {
    return `Provider key 非法: ${provider.key}`;
  }
  if (!provider.api_type) {
    return `Provider ${provider.key} 缺少 api_type`;
  }
  if (provider.models.length === 0) {
    return `Provider ${provider.key} 至少需要一个模型。`;
  }
  const aliases = new Set<string>();
  for (const model of provider.models) {
    if (aliases.has(model.alias)) {
      return `Provider ${provider.key} 存在重复模型别名: ${model.alias}`;
    }
    aliases.add(model.alias);
  }
  return null;
}

function validateProviderTestDraft(provider: NormalizedProviderTestDraft): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.key)) {
    return `Provider key 非法: ${provider.key}`;
  }
  if (!provider.api_type) {
    return `Provider ${provider.key} 缺少 api_type`;
  }
  return null;
}

function resolveDefaultRoute(
  llm: MutableLLMConfig,
  secrets: SecretsDocument,
): ConfigurationRouteSnapshot {
  const explicitProviderKey = llm.default_route?.provider?.trim();
  const explicitModelAlias = llm.default_route?.model_alias?.trim();
  if (explicitProviderKey) {
    const provider = llm.providers?.[explicitProviderKey];
    if (!provider) {
      return {
        provider_key: explicitProviderKey,
        model_alias: explicitModelAlias,
        ready: false,
        reason: '默认路由引用的 Provider 不存在。',
      };
    }
    const selectedModel = explicitModelAlias
      ? provider.models?.[explicitModelAlias]
      : firstModelEntry(provider.models)?.model_id;
    if (!selectedModel) {
      return {
        provider_key: explicitProviderKey,
        model_alias: explicitModelAlias,
        ready: false,
        reason: '默认路由未选择可用模型。',
      };
    }
    if (!secrets.providers?.[explicitProviderKey]?.api_key?.trim()) {
      return {
        provider_key: explicitProviderKey,
        model_alias: explicitModelAlias,
        effective_model_id: selectedModel,
        ready: false,
        reason: '默认路由 Provider 尚未配置 API Key。',
      };
    }
    return {
      provider_key: explicitProviderKey,
      model_alias: explicitModelAlias || firstModelEntry(provider.models)?.alias,
      effective_model_id: selectedModel,
      ready: true,
    };
  }

  const inferred = inferLegacyDefaultRoute(llm);
  if (inferred) {
    const inferredProviderKey = inferred.provider_key?.trim();
    const apiKey = (inferredProviderKey ? secrets.providers?.[inferredProviderKey]?.api_key?.trim() : '')
      || secrets.providers?.[String(llm.api_type ?? '').toLowerCase()]?.api_key?.trim();
    return {
      ...inferred,
      ready: Boolean(apiKey && inferred.effective_model_id),
      reason: apiKey ? undefined : '默认路由尚未配置 API Key。',
    };
  }

  const rootModel = firstModelEntry(llm.models);
  if (rootModel) {
    const rootSecret = secrets.providers?.[String(llm.api_type ?? '').toLowerCase()]?.api_key?.trim();
    return {
      model_alias: rootModel.alias,
      effective_model_id: rootModel.model_id,
      ready: Boolean(rootSecret),
      reason: rootSecret ? undefined : '当前根路由缺少 API Key。',
    };
  }

  return {
    ready: false,
    reason: '尚未配置默认对话模型。',
  };
}

function inferLegacyDefaultRoute(llm: MutableLLMConfig): ConfigurationRouteSnapshot | null {
  const rootModel = firstModelEntry(llm.models);
  if (!rootModel) return null;
  for (const [providerKey, provider] of Object.entries(llm.providers ?? {})) {
    if (provider.api_type !== llm.api_type) {
      continue;
    }
    const matchedAlias = modelEntries(provider.models).find((entry) => entry.model_id === rootModel.model_id);
    if (!matchedAlias) {
      continue;
    }
    return {
      provider_key: providerKey,
      model_alias: matchedAlias.alias,
      effective_model_id: matchedAlias.model_id,
      ready: false,
    };
  }
  return null;
}

function modelEntries(models: Record<string, string> | undefined): ConfigurationModelAlias[] {
  return Object.entries(models ?? {})
    .map(([alias, modelId]) => ({ alias, model_id: modelId }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

function firstModelEntry(models: Record<string, string> | undefined): ConfigurationModelAlias | null {
  const [alias, modelId] = Object.entries(models ?? {})[0] ?? [];
  return alias && modelId ? { alias, model_id: modelId } : null;
}

async function readYamlFile<T>(filePath: string, fallback?: T): Promise<T> {
  const exists = await fs.pathExists(filePath);
  if (!exists) {
    if (fallback !== undefined) return deepClone(fallback);
    throw new Error(`缺少配置文件: ${filePath}`);
  }
  const content = await fs.readFile(filePath, 'utf8');
  return (yaml.parse(content) ?? fallback ?? {}) as T;
}

async function readValidatedYamlFile<T>(schemaName: 'LLMConfig' | 'AudioConfig' | 'EmbeddingConfig' | 'MemoryConfig' | 'SkillPlaneConfig', filePath: string): Promise<T> {
  const parsed = await readYamlFile<unknown>(filePath);
  return validateOrThrow<T>(schemaName, parsed);
}

function validateOrThrow<T>(schemaName: 'LLMConfig' | 'AudioConfig' | 'EmbeddingConfig' | 'MemoryConfig' | 'SkillPlaneConfig', value: unknown): T {
  const validation = validateConfig<T>(schemaName, deepClone(value));
  if (!validation.ok || !validation.data) {
    throw new Error(validation.errors.join('; '));
  }
  return validation.data;
}

function computeRevision(bundle: Pick<ConfigDocumentBundle, 'llm' | 'secrets' | 'audio' | 'embedding' | 'memory' | 'skills'>): string {
  const digest = createHash('sha256');
  digest.update(JSON.stringify(bundle.llm));
  digest.update('\n');
  digest.update(JSON.stringify(bundle.secrets.providers ?? {}));
  digest.update('\n');
  digest.update(JSON.stringify(bundle.audio));
  digest.update('\n');
  digest.update(JSON.stringify(bundle.embedding));
  digest.update('\n');
  digest.update(JSON.stringify(bundle.memory));
  digest.update('\n');
  digest.update(JSON.stringify(bundle.skills));
  return digest.digest('hex').slice(0, 16);
}

function summarizeChanges(
  current: Pick<ConfigDocumentBundle, 'llm' | 'secrets' | 'audio' | 'embedding' | 'memory' | 'skills'>,
  next: Pick<ConfigDocumentBundle, 'llm' | 'secrets' | 'audio' | 'embedding' | 'memory' | 'skills'>,
): string[] {
  const lines: string[] = [];
  const currentProviders = new Set(Object.keys(current.llm.providers ?? {}));
  const nextProviders = new Set(Object.keys(next.llm.providers ?? {}));

  for (const providerKey of [...nextProviders].filter((key) => !currentProviders.has(key)).sort()) {
    lines.push(`新增 Provider ${providerKey}`);
  }
  for (const providerKey of [...currentProviders].filter((key) => !nextProviders.has(key)).sort()) {
    lines.push(`删除 Provider ${providerKey}`);
  }
  for (const providerKey of [...nextProviders].filter((key) => currentProviders.has(key)).sort()) {
    const before = current.llm.providers?.[providerKey];
    const after = next.llm.providers?.[providerKey];
    if (!before || !after) continue;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      lines.push(`更新 Provider ${providerKey} 配置`);
    }
    const beforeSecret = current.secrets.providers?.[providerKey]?.api_key?.trim() || '';
    const afterSecret = next.secrets.providers?.[providerKey]?.api_key?.trim() || '';
    if (!beforeSecret && afterSecret) lines.push(`写入 Provider ${providerKey} API Key`);
    if (beforeSecret && !afterSecret) lines.push(`清除 Provider ${providerKey} API Key`);
    if (beforeSecret && afterSecret && beforeSecret !== afterSecret) lines.push(`更新 Provider ${providerKey} API Key`);
  }

  const beforeRoute = `${current.llm.default_route?.provider ?? ''}/${current.llm.default_route?.model_alias ?? ''}`;
  const afterRoute = `${next.llm.default_route?.provider ?? ''}/${next.llm.default_route?.model_alias ?? ''}`;
  if (beforeRoute !== afterRoute) {
    if (afterRoute !== '/') {
      lines.push(`切换默认路由到 ${afterRoute.replace(/\/$/, '')}`);
    } else {
      lines.push('清除默认对话路由');
    }
  }
  if (current.audio.tts.enabled !== next.audio.tts.enabled) {
    lines.push(next.audio.tts.enabled ? '启用 TTS 增强' : '停用 TTS 增强');
  } else if (current.audio.asr.enabled !== next.audio.asr.enabled) {
    lines.push(next.audio.asr.enabled ? '启用 ASR 增强' : '停用 ASR 增强');
  } else if (JSON.stringify(current.audio) !== JSON.stringify(next.audio)) {
    lines.push('更新 Audio 配置');
  }
  if (current.embedding.enabled !== next.embedding.enabled) {
    lines.push(next.embedding.enabled ? '启用 Embedding 增强' : '停用 Embedding 增强');
  } else if (JSON.stringify(current.embedding) !== JSON.stringify(next.embedding)) {
    lines.push('更新 Embedding 配置');
  }
  if (current.memory.experience?.enabled !== next.memory.experience?.enabled) {
    lines.push(next.memory.experience?.enabled ? '启用 Experience 归档' : '停用 Experience 归档');
  } else if (JSON.stringify(current.memory) !== JSON.stringify(next.memory)) {
    lines.push('更新 Memory / Experience 配置');
  }
  if (current.skills.user_skills?.enabled !== next.skills.user_skills?.enabled) {
    lines.push(next.skills.user_skills?.enabled ? '启用 User Skills' : '停用 User Skills');
  } else if ((current.skills.mcp_servers?.length ?? 0) !== (next.skills.mcp_servers?.length ?? 0)) {
    lines.push(`更新 MCP Server 列表（${current.skills.mcp_servers?.length ?? 0} -> ${next.skills.mcp_servers?.length ?? 0}）`);
  } else if (JSON.stringify(current.skills) !== JSON.stringify(next.skills)) {
    lines.push('更新 Skill Plane 配置');
  }
  return lines;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 240);
  } catch {
    return '';
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}
