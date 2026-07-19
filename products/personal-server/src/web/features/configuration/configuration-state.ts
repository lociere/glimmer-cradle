import type {
  AudioConfig,
  ConfigurationModelAlias,
  ConfigurationSnapshot,
  EmbeddingConfig,
  MemoryConfig,
  SkillPlaneConfig,
} from '@glimmer-cradle/protocol';

export interface ProviderDraftState {
  key: string;
  api_type: string;
  base_url: string;
  api_key: string;
  clear_api_key: boolean;
  has_api_key: boolean;
  temperature: string;
  request_method: '' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  request_path: string;
  request_body_template: string;
  response_extract: string;
  models: Array<{ alias: string; model_id: string }>;
}

export interface ConfigurationDraftState {
  revision: string;
  providers: ProviderDraftState[];
  defaultRouteProviderKey: string;
  defaultRouteModelAlias: string;
  audio: AudioConfig;
  embedding: EmbeddingConfig;
  memory: MemoryConfig;
  skills: SkillPlaneConfig;
}

export interface ConfigurationStatusState {
  readonly kind: 'idle' | 'loading' | 'preview' | 'saving' | 'success' | 'error';
  readonly message?: string;
  readonly summary?: readonly string[];
}

export function snapshotToDraft(snapshot: ConfigurationSnapshot): ConfigurationDraftState {
  return {
    revision: snapshot.revision,
    defaultRouteProviderKey: snapshot.llm.default_route.provider_key || '',
    defaultRouteModelAlias: snapshot.llm.default_route.model_alias || '',
    audio: deepClone(snapshot.audio),
    embedding: deepClone(snapshot.embedding),
    memory: deepClone(snapshot.memory),
    skills: deepClone(snapshot.skills),
    providers: snapshot.llm.providers.map((provider) => ({
      key: provider.key,
      api_type: provider.api_type,
      base_url: provider.base_url || '',
      api_key: '',
      clear_api_key: false,
      has_api_key: provider.has_api_key,
      temperature: provider.temperature === undefined ? '' : String(provider.temperature),
      request_method: provider.request_method || '',
      request_path: provider.request_path || '',
      request_body_template: '',
      response_extract: provider.response_extract || '',
      models: provider.models.map((model) => ({ alias: model.alias, model_id: model.model_id })),
    })),
  };
}

export function createProviderDraft(key: string): ProviderDraftState {
  return {
    key,
    api_type: 'openai',
    base_url: '',
    api_key: '',
    clear_api_key: false,
    has_api_key: false,
    temperature: '',
    request_method: '',
    request_path: '',
    request_body_template: '',
    response_extract: '',
    models: [{ alias: 'chat', model_id: '' }],
  };
}

export function mergeDiscoveredModels(
  current: Array<{ alias: string; model_id: string }>,
  discovered: readonly string[],
): Array<{ alias: string; model_id: string }> {
  const merged = current.map((model) => ({ ...model }));
  const remaining = discovered.filter((modelId) => !merged.some((model) => model.model_id === modelId));

  for (const model of merged) {
    if (model.model_id || remaining.length === 0) continue;
    const discoveredModelId = remaining.shift();
    if (!discoveredModelId) break;
    model.model_id = discoveredModelId;
  }

  for (const modelId of remaining) {
    merged.push({
      alias: suggestAlias(modelId, merged.length),
      model_id: modelId,
    });
  }
  return merged;
}

function suggestAlias(modelId: string, index: number): string {
  const candidate = modelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return candidate || `model-${index + 1}`;
}

export function asTupleModels(
  models: Array<{ alias: string; model_id: string }>,
): [ConfigurationModelAlias, ...ConfigurationModelAlias[]] {
  return models as [ConfigurationModelAlias, ...ConfigurationModelAlias[]];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
