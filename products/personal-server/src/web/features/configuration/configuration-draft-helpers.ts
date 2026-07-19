import type {
  ConfigurationProviderDraft,
  ConfigurationProviderTestDraft,
  ConfigurationSnapshot,
  ConfigurationUpdateRequest,
} from '@glimmer-cradle/protocol';
import { asTupleModels, snapshotToDraft, type ConfigurationDraftState, type ProviderDraftState } from './configuration-state';
import { createRequestId } from './configuration-support';

export function routeModelOptions(
  draft: ConfigurationDraftState | null,
): Array<{ alias: string; model_id: string }> {
  if (!draft?.defaultRouteProviderKey) return [];
  return (draft.providers.find((provider) => provider.key === draft.defaultRouteProviderKey)?.models ?? [])
    .filter((model) => model.alias && model.model_id);
}

export function isDraftDirty(snapshot: ConfigurationSnapshot | null, draft: ConfigurationDraftState | null): boolean {
  if (!snapshot || !draft) return false;
  return JSON.stringify(draft) !== JSON.stringify(snapshotToDraft(snapshot));
}

export function validateDraft(draft: ConfigurationDraftState | null): string | null {
  if (!draft) return '配置尚未加载。';
  const keys = new Set<string>();
  for (const provider of draft.providers) {
    if (!provider.key || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.key)) {
      return 'Provider key 必须是小写字母、数字、点、下划线或中划线。';
    }
    if (keys.has(provider.key)) {
      return `Provider key 重复：${provider.key}`;
    }
    keys.add(provider.key);
    if (!provider.api_type) {
      return `Provider ${provider.key} 缺少 API 协议类型。`;
    }
    const validModels = provider.models.filter((model) => model.alias && model.model_id);
    if (validModels.length === 0) {
      return `Provider ${provider.key} 至少需要一个完整模型。`;
    }
  }
  if (draft.defaultRouteProviderKey) {
    const provider = draft.providers.find((item) => item.key === draft.defaultRouteProviderKey);
    if (!provider) return '默认路由引用的 Provider 不存在。';
    if (!provider.models.some((model) => model.alias === draft.defaultRouteModelAlias && model.model_id)) {
      return '默认路由引用的模型别名不存在。';
    }
  }
  if (!draft.audio.tts.route.primary) {
    return 'TTS 主路由不能为空。';
  }
  if (!draft.skills.user_skills?.root_dir?.trim()) {
    return 'User Skills 根目录不能为空。';
  }
  const mcpIds = new Set<string>();
  for (const server of draft.skills.mcp_servers ?? []) {
    const id = server.id.trim();
    if (!id) {
      return 'MCP Server ID 不能为空。';
    }
    if (mcpIds.has(id)) {
      return `MCP Server ID 重复：${id}`;
    }
    mcpIds.add(id);
    if ((server.products?.length ?? 0) === 0) {
      return `MCP Server ${id} 至少需要一个 products 目标。`;
    }
    if (server.transport === 'stdio' && !server.command?.trim()) {
      return `MCP Server ${id} 缺少 command。`;
    }
    if ((server.transport === 'http' || server.transport === 'websocket') && !server.url?.trim()) {
      return `MCP Server ${id} 缺少 URL。`;
    }
  }
  return null;
}

export function buildUpdateRequest(
  snapshot: ConfigurationSnapshot | null,
  draft: ConfigurationDraftState | null,
  dryRun: boolean,
): ConfigurationUpdateRequest | { error: string } {
  const validationError = validateDraft(draft);
  if (!draft || validationError) {
    return { error: validationError || '配置尚未加载。' };
  }

  const providers = draft.providers
    .map((provider) => toProviderDraft(provider))
    .filter((provider): provider is ConfigurationProviderDraft => provider !== null);
  const currentKeys = new Set(snapshot?.llm.providers.map((provider) => provider.key) ?? []);
  const nextKeys = new Set(providers.map((provider) => provider.key));
  const removedProviderKeys = [...currentKeys].filter((key) => !nextKeys.has(key)).sort();

  return {
    request_id: createRequestId(dryRun ? 'config-preview' : 'config-save'),
    revision: draft.revision,
    dry_run: dryRun,
    llm: {
      default_route_provider_key: draft.defaultRouteProviderKey || undefined,
      default_route_model_alias: draft.defaultRouteProviderKey ? draft.defaultRouteModelAlias || undefined : undefined,
      providers,
      removed_provider_keys: removedProviderKeys,
    },
    audio: deepClone(draft.audio),
    embedding: deepClone(draft.embedding),
    memory: deepClone(draft.memory),
    skills: deepClone(draft.skills),
  };
}

export function toProviderDraft(provider: ProviderDraftState | null): ConfigurationProviderDraft | null {
  if (!provider) return null;
  const models = provider.models
    .filter((model) => model.alias && model.model_id)
    .map((model) => ({ alias: model.alias, model_id: model.model_id }));
  if (models.length === 0) return null;
  return {
    key: provider.key,
    api_type: provider.api_type,
    base_url: provider.base_url || undefined,
    api_key: provider.api_key || undefined,
    clear_api_key: provider.clear_api_key || undefined,
    temperature: provider.temperature ? Number(provider.temperature) : undefined,
    request_method: provider.request_method || undefined,
    request_path: provider.request_path || undefined,
    request_body_template: provider.request_body_template || undefined,
    response_extract: provider.response_extract || undefined,
    models: asTupleModels(models),
  };
}

export function toProviderTestDraft(provider: ProviderDraftState | null): ConfigurationProviderTestDraft | null {
  if (!provider) return null;
  const key = provider.key.trim();
  const apiType = provider.api_type.trim();
  if (!key || !apiType) return null;
  return {
    key,
    api_type: apiType,
    base_url: provider.base_url || undefined,
    api_key: provider.api_key || undefined,
    clear_api_key: provider.clear_api_key || undefined,
    temperature: provider.temperature ? Number(provider.temperature) : undefined,
    request_method: provider.request_method || undefined,
    request_path: provider.request_path || undefined,
    request_body_template: provider.request_body_template || undefined,
    response_extract: provider.response_extract || undefined,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
