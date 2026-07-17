import type {
  RegisteredSkill,
  SkillCatalogEntry,
  SkillCatalogSnapshot,
  SkillDescriptor,
  SkillAudience,
  SkillProviderKind,
  SkillProviderRef,
  SkillProviderRuntimeSnapshot,
  SkillRuntimeStatus,
} from './types';
import { GLOBAL_CAPABILITY_SCOPE } from './scope';

const PROVIDER_KINDS: SkillProviderKind[] = ['core', 'extension', 'mcp_server', 'user'];
const RUNTIME_STATUSES: SkillRuntimeStatus[] = ['ready', 'contract_only'];

export class SkillRegistry {
  private static _instance: SkillRegistry | null = null;
  private readonly _skills = new Map<string, RegisteredSkill>();
  private readonly _providerRuntimes = new Map<string, SkillProviderRuntimeSnapshot>();

  public static get instance(): SkillRegistry {
    if (!SkillRegistry._instance) {
      SkillRegistry._instance = new SkillRegistry();
    }
    return SkillRegistry._instance;
  }

  private constructor() {}

  public registerSkill(skill: SkillDescriptor): void {
    this._skills.set(skill.id, {
      providerId: skill.provider.id,
      skill,
    });
  }

  public unregisterSkill(skillId: string): void {
    this._skills.delete(skillId);
  }

  public upsertProviderRuntime(runtime: SkillProviderRuntimeSnapshot): void {
    this._providerRuntimes.set(providerRuntimeKey(runtime.provider), runtime);
  }

  public removeProviderRuntime(provider: SkillProviderRef): void {
    this._providerRuntimes.delete(providerRuntimeKey(provider));
  }

  public getAll(): RegisteredSkill[] {
    return Array.from(this._skills.values());
  }

  public listCatalogEntries(): SkillCatalogEntry[] {
    return this.getAll()
      .filter(({ skill }) => resolveSkillAudience(skill) === 'character')
      .map(({ skill }) => this.toCatalogEntry(skill))
      .filter((entry) => entry.tools.length > 0 || entry.resources.length > 0 || entry.prompts.length > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getCatalogSnapshot(): SkillCatalogSnapshot {
    const entries = this.listCatalogEntries();
    const providerCounts = Object.fromEntries(PROVIDER_KINDS.map((kind) => [kind, 0])) as Record<
      SkillProviderKind,
      number
    >;
    const runtimeStatusCounts = Object.fromEntries(
      RUNTIME_STATUSES.map((status) => [status, 0]),
    ) as Record<SkillRuntimeStatus, number>;

    for (const entry of entries) {
      providerCounts[entry.provider.kind] += 1;
      const runtimeStatus: SkillRuntimeStatus = entry.metadata.runtime_status === 'contract_only'
        ? 'contract_only'
        : 'ready';
      runtimeStatusCounts[runtimeStatus] += 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      totalSkills: entries.length,
      providerCounts,
      runtimeStatusCounts,
      totalTools: entries.reduce((total, entry) => total + entry.tools.length, 0),
      totalResources: entries.reduce((total, entry) => total + entry.resources.length, 0),
      totalPrompts: entries.reduce((total, entry) => total + entry.prompts.length, 0),
      providerRuntimes: this.buildProviderRuntimes(entries),
      entries,
    };
  }

  public getByProvider(providerKind: SkillProviderKind, providerId?: string): RegisteredSkill[] {
    return this.getAll().filter(({ skill }) => {
      if (skill.provider.kind !== providerKind) {
        return false;
      }
      return providerId ? skill.provider.id === providerId : true;
    });
  }

  public findById(skillId: string): RegisteredSkill | undefined {
    return this._skills.get(skillId);
  }

  public findByName(skillName: string): RegisteredSkill | undefined {
    return this.getAll().find(({ skill }) => skill.name === skillName);
  }

  private toCatalogEntry(skill: SkillDescriptor): SkillCatalogEntry {
    const audience = resolveSkillAudience(skill);
    const scope = skill.scope ?? GLOBAL_CAPABILITY_SCOPE;
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      audience,
      scope,
      provider: { ...skill.provider },
      tools: skill.tools
        .filter((tool) => resolveToolAudience(skill, tool) === 'character')
        .map(({ name, description, parameters, scope: toolScope }) => ({
          name,
          description,
          audience: 'character',
          scope: toolScope ?? scope,
          parameters,
        })),
      resources: (skill.resources ?? [])
        .filter((resource) => resolveResourceAudience(skill, resource) === 'character')
        .map(({ id, description, parameters, scope: resourceScope }) => ({
          id,
          description,
          audience: 'character',
          scope: resourceScope ?? scope,
          parameters,
        })),
      prompts: (skill.prompts ?? [])
        .filter((prompt) => resolvePromptAudience(skill, prompt) === 'character')
        .map(({ id, description, parameters, scope: promptScope }) => ({
          id,
          description,
          audience: 'character',
          scope: promptScope ?? scope,
          parameters,
        })),
      policy: {
        riskLevel: skill.policy.riskLevel,
        confirmationRequired: skill.policy.confirmationRequired,
        sideEffects: [...skill.policy.sideEffects],
        audit: skill.policy.audit,
      },
      metadata: { ...(skill.metadata ?? {}), audience },
    };
  }

  private buildProviderRuntimes(entries: SkillCatalogEntry[]): SkillProviderRuntimeSnapshot[] {
    const aggregated = new Map<string, SkillProviderRuntimeSnapshot>();

    for (const entry of entries) {
      const key = providerRuntimeKey(entry.provider);
      const current = aggregated.get(key);
      const next = mergeProviderRuntimeEntry(current, entry);
      aggregated.set(key, next);
    }

    for (const runtime of this._providerRuntimes.values()) {
      const key = providerRuntimeKey(runtime.provider);
      const current = aggregated.get(key);
      aggregated.set(key, mergeExplicitProviderRuntime(current, runtime));
    }

    return Array.from(aggregated.values())
      .sort((left, right) => (
        left.provider.kind === right.provider.kind
          ? left.provider.id.localeCompare(right.provider.id)
          : left.provider.kind.localeCompare(right.provider.kind)
      ));
  }
}

function mergeProviderRuntimeEntry(
  current: SkillProviderRuntimeSnapshot | undefined,
  entry: SkillCatalogEntry,
): SkillProviderRuntimeSnapshot {
  const runtimeStatus = entry.metadata.runtime_status === 'contract_only' ? 'contract_only' : 'ready';
  const toolCount = entry.tools.length;
  const resourceCount = entry.resources.length;
  const promptCount = entry.prompts.length;

  if (!current) {
    return {
      provider: entry.provider,
      display_name: entry.provider.id,
      state: runtimeStatus,
      summary: runtimeStatus === 'ready' ? '能力来源已就绪。' : '能力来源仅声明契约，尚未接入执行承载。',
      skill_count: 1,
      tool_count: toolCount,
      resource_count: resourceCount,
      prompt_count: promptCount,
      recovery_actions: runtimeStatus === 'ready' ? [] : ['完成能力来源的执行承载后再暴露给角色。'],
      metadata: {},
      updated_at: new Date().toISOString(),
    };
  }

  const nextState = mergeRuntimeState(current.state, runtimeStatus);
  return {
    ...current,
    state: nextState,
    summary: nextState === 'ready'
      ? '能力来源已就绪。'
      : nextState === 'contract_only'
        ? '能力来源仅声明契约，尚未接入执行承载。'
        : current.summary,
    skill_count: current.skill_count + 1,
    tool_count: current.tool_count + toolCount,
    resource_count: current.resource_count + resourceCount,
    prompt_count: current.prompt_count + promptCount,
    updated_at: new Date().toISOString(),
  };
}

function mergeExplicitProviderRuntime(
  current: SkillProviderRuntimeSnapshot | undefined,
  runtime: SkillProviderRuntimeSnapshot,
): SkillProviderRuntimeSnapshot {
  if (!current) {
    return runtime;
  }

  return {
    ...runtime,
    display_name: runtime.display_name || current.display_name,
    skill_count: current.skill_count > 0 ? current.skill_count : runtime.skill_count,
    tool_count: current.tool_count > 0 ? current.tool_count : runtime.tool_count,
    resource_count: current.resource_count > 0 ? current.resource_count : runtime.resource_count,
    prompt_count: current.prompt_count > 0 ? current.prompt_count : runtime.prompt_count,
  };
}

function mergeRuntimeState(
  current: SkillProviderRuntimeSnapshot['state'],
  next: SkillProviderRuntimeSnapshot['state'],
): SkillProviderRuntimeSnapshot['state'] {
  if (current === next) return current;
  if (current === 'ready' || next === 'ready') return 'ready';
  if (current === 'contract_only' && next === 'contract_only') return 'contract_only';
  return current;
}

function providerRuntimeKey(provider: SkillProviderRef): string {
  return `${provider.kind}:${provider.id}`;
}

export function resolveSkillAudience(skill: SkillDescriptor): SkillAudience {
  const explicit = skill.audience ?? skill.metadata?.audience;
  if (explicit) return explicit;
  return skill.provider.kind === 'extension' ? 'host' : 'character';
}

export function resolveToolAudience(
  skill: SkillDescriptor,
  tool: { audience?: SkillAudience },
): SkillAudience {
  return tool.audience ?? resolveSkillAudience(skill);
}

export function resolveResourceAudience(
  skill: SkillDescriptor,
  resource: { audience?: SkillAudience },
): SkillAudience {
  return resource.audience ?? resolveSkillAudience(skill);
}

export function resolvePromptAudience(
  skill: SkillDescriptor,
  prompt: { audience?: SkillAudience },
): SkillAudience {
  return prompt.audience ?? resolveSkillAudience(skill);
}
