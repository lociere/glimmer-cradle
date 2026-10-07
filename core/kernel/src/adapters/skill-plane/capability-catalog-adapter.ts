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
} from '../../ports/skill-plane.port';
import { GLOBAL_CAPABILITY_SCOPE, ToolRegistry, ResourceRegistry, SkillCatalog, executionDigest,
  isCapabilityDefinitionVisible } from '@glimmer-cradle/capabilities';
import type { CapabilityDefinition, CapabilityScopeContext, Tool, Resource, Skill, SkillReference, SkillMaterial, SkillSummary } from '@glimmer-cradle/capabilities';

const PROVIDER_KINDS: SkillProviderKind[] = ['core', 'extension', 'mcp_server', 'user'];
const RUNTIME_STATUSES: SkillRuntimeStatus[] = ['ready', 'contract_only'];

/** 当前 SDK/wire 分组与 handler 的接入映射；三类定义唯一事实源在 Capabilities Core。 */
export class CapabilityCatalogAdapter {
  private readonly _skills = new Map<string, RegisteredSkill>();
  private readonly _providerRuntimes = new Map<string, SkillProviderRuntimeSnapshot>();
  public readonly tools = new ToolRegistry();
  public readonly resources = new ResourceRegistry();
  public readonly methods = new SkillCatalog();
  private readonly toolBindings = new Map<string, { definition: Tool; target: SkillDescriptor['tools'][number]; handler: SkillDescriptor['tools'][number]['handler'] }>();
  private readonly resourceBindings = new Map<string, { definition: Resource; target: NonNullable<SkillDescriptor['resources']>[number]; read: NonNullable<SkillDescriptor['resources']>[number]['read'] }>();
  private readonly methodBindings = new Map<string, { definition: Skill; target: NonNullable<SkillDescriptor['prompts']>[number]; render: NonNullable<SkillDescriptor['prompts']>[number]['render'] }>();
  private readonly owners = new Map<string, string>();

  public constructor() {}

  public registerSkill(skill: SkillDescriptor): void {
    const owner = providerRuntimeKey(skill.provider);
    if (this.owners.has(skill.id) && this.owners.get(skill.id) !== owner) throw new Error('Capability owner 冲突');
    const base = (id: string, name: string, description: string, audience: SkillAudience,
      scope: SkillDescriptor['scope'], revision: string): CapabilityDefinition => ({
      id, owner_id: owner, revision, name, description,
      audience: resolveSkillAudience(skill) === 'character' ? audience : resolveSkillAudience(skill),
      readiness: skill.metadata?.runtime_status === 'contract_only' ? 'contract_only' : 'ready',
      scopes: [skill.scope ?? GLOBAL_CAPABILITY_SCOPE, scope ?? skill.scope ?? GLOBAL_CAPABILITY_SCOPE],
    });
    // 先完整验证，再同步提交；坏 schema/重复名字不会撤销上一有效快照或留下半份贡献。
    const tools = new ToolRegistry(); const resources = new ResourceRegistry(); const methods = new SkillCatalog();
    for (const tool of skill.tools) {
      const id = capabilityKey(skill.id, tool.name);
      if (tools.get(id)) throw new Error('重复 Tool');
      tools.register({ ...base(id, tool.name, tool.description, resolveToolAudience(skill, tool), tool.scope,
        toolRevision(skill, tool)), input_schema: tool.parameters ?? null, executor_id: skill.provider.id });
    }
    for (const resource of skill.resources ?? []) {
      const id = capabilityKey(skill.id, resource.id);
      if (resources.get(id)) throw new Error('重复 Resource');
      resources.register({ ...base(id, resource.id, resource.description, resolveResourceAudience(skill, resource), resource.scope,
        readerRevision(skill, resource)), input_schema: resource.parameters ?? null, reader_id: owner });
    }
    for (const prompt of skill.prompts ?? []) {
      const id = capabilityKey(skill.id, prompt.id);
      if (methods.get(id)) throw new Error('重复 Skill method');
      methods.register({ ...base(id, prompt.id, prompt.description, resolvePromptAudience(skill, prompt), prompt.scope,
        readerRevision(skill, prompt)), instructions: prompt.render
          ? { kind: 'reader', reader_id: owner, input_schema: prompt.parameters ?? null }
          : { kind: 'inline', text: prompt.template } });
    }
    this.unregisterSkill(skill.id);
    this.owners.set(skill.id, owner);
    for (const tool of skill.tools) {
      const definition = this.tools.register(tools.get(capabilityKey(skill.id, tool.name))!);
      this.toolBindings.set(definition.id, { definition, target: tool, handler: tool.handler });
    }
    for (const resource of skill.resources ?? []) {
      const definition = this.resources.register(resources.get(capabilityKey(skill.id, resource.id))!);
      this.resourceBindings.set(definition.id, { definition, target: resource, read: resource.read });
    }
    for (const prompt of skill.prompts ?? []) {
      const definition = this.methods.register(methods.get(capabilityKey(skill.id, prompt.id))!);
      this.methodBindings.set(definition.id, { definition, target: prompt, render: prompt.render });
    }
    this._skills.set(skill.id, {
      providerId: skill.provider.id,
      skill,
    });
  }

  public unregisterSkill(skillId: string): void {
    const owner = this.owners.get(skillId);
    // 使用注册时保存的 owner/ID，而不是可变 SDK 对象；卸载必须回收被原地修改过的贡献。
    if (owner) {
      for (const [id] of this.toolBindings) if (JSON.parse(id)[0] === skillId) {
        this.tools.revoke(id, owner); this.toolBindings.delete(id);
      }
      for (const [id] of this.resourceBindings) if (JSON.parse(id)[0] === skillId) {
        this.resources.revoke(id, owner); this.resourceBindings.delete(id);
      }
      for (const [id] of this.methodBindings) if (JSON.parse(id)[0] === skillId) {
        this.methods.revoke(id, owner); this.methodBindings.delete(id);
      }
    }
    this.owners.delete(skillId);
    this._skills.delete(skillId);
  }

  public findTool(skillId: string, name: string): Tool | undefined {
    const id = capabilityKey(skillId, name); const binding = this.toolBindings.get(id); const skill = this._skills.get(skillId)?.skill;
    if (!skill || !binding || this.tools.get(id) !== binding.definition
      || !skill.tools.includes(binding.target) || binding.target.handler !== binding.handler) return undefined;
    try { return toolRevision(skill, binding.target) === binding.definition.revision ? binding.definition : undefined; }
    catch { return undefined; }
  }

  public findResource(skillId: string, name: string): Resource | undefined {
    const id = capabilityKey(skillId, name); const binding = this.resourceBindings.get(id); const skill = this._skills.get(skillId)?.skill;
    if (!skill || !binding || this.resources.get(id) !== binding.definition
      || !skill.resources?.includes(binding.target) || binding.target.read !== binding.read) return undefined;
    try { return readerRevision(skill, binding.target) === binding.definition.revision ? binding.definition : undefined; }
    catch { return undefined; }
  }

  public findMethod(skillId: string, name: string): Skill | undefined {
    const id = capabilityKey(skillId, name); const binding = this.methodBindings.get(id); const skill = this._skills.get(skillId)?.skill;
    if (!skill || !binding || this.methods.get(id) !== binding.definition
      || !skill.prompts?.includes(binding.target) || binding.target.render !== binding.render) return undefined;
    try { return readerRevision(skill, binding.target) === binding.definition.revision ? binding.definition : undefined; }
    catch { return undefined; }
  }

  public listReadyTools(context?: CapabilityScopeContext): Array<{ skill_id: string; tool_name: string; description: string; parameters: unknown }> {
    return this.tools.list().filter(tool => isCapabilityDefinitionVisible(tool, context)).flatMap(tool => {
      const [skillId, name] = JSON.parse(tool.id) as [string, string];
      return this.findTool(skillId, name) === tool && this.isProviderReady(tool.owner_id)
        ? [{ skill_id: skillId, tool_name: name, description: tool.description, parameters: tool.input_schema }] : [];
    });
  }

  public isProviderReady(ownerId: string): boolean {
    const runtime = this._providerRuntimes.get(ownerId);
    return !runtime || runtime.state === 'ready';
  }

  public listReadyMethods(context?: CapabilityScopeContext): readonly SkillSummary[] {
    return this.methods.inlineSummaries(context).filter(summary => {
      const binding = this.methodBindings.get(summary.reference.skill_id);
      if (!binding) return false;
      const [group, name] = JSON.parse(binding.definition.id) as [string, string];
      return this._skills.get(group)?.skill.policy.confirmationRequired === false
        && this.findMethod(group, name) === binding.definition && this.isInlineMethodSourceReady(group, binding.definition);
    });
  }

  public readMethod(reference: SkillReference, context?: CapabilityScopeContext): SkillMaterial | undefined {
    const binding = this.methodBindings.get(reference.skill_id);
    if (!binding) return undefined;
    const [group, name] = JSON.parse(binding.definition.id) as [string, string];
    // 兼容边缘的确认策略仍有效；正文加载不能绕过旧 prompt 的受控 Gateway。
    if (this._skills.get(group)?.skill.policy.confirmationRequired !== false
      || this.findMethod(group, name) !== binding.definition || !this.isInlineMethodSourceReady(group, binding.definition)) return undefined;
    return this.methods.inlineMaterial(reference, context);
  }

  private isInlineMethodSourceReady(group: string, definition: Skill): boolean {
    if (this.isProviderReady(definition.owner_id)) return true;
    const runtime = this._providerRuntimes.get(definition.owner_id);
    const source = this._skills.get(group)?.skill;
    // User 的逐文件成功加载事实独立于总体诊断；不得放宽 Tool 或 MCP reader 的 readiness。
    const loaded = runtime?.metadata.ready_inline_method_groups;
    return runtime?.state === 'degraded' && runtime.provider.kind === 'user'
      && source?.provider.kind === 'user' && source.metadata?.implementation === 'user_skill_instructions'
      && definition.instructions.kind === 'inline' && Array.isArray(loaded) && loaded.includes(group);
  }

  public upsertProviderRuntime(runtime: SkillProviderRuntimeSnapshot): void {
    const loaded = runtime.metadata.ready_inline_method_groups;
    const metadata = Object.freeze({ ...runtime.metadata, ...(Array.isArray(loaded)
      ? { ready_inline_method_groups: Object.freeze([...loaded]) } : {}) });
    this._providerRuntimes.set(providerRuntimeKey(runtime.provider), Object.freeze({ ...runtime,
      provider: Object.freeze({ ...runtime.provider }), recovery_actions: [...runtime.recovery_actions], metadata }));
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
        .filter((tool) => this.findTool(skill.id, tool.name)?.audience === 'character')
        .map(tool => ({
          name: tool.name,
          description: this.findTool(skill.id, tool.name)!.description,
          audience: 'character',
          scope: this.findTool(skill.id, tool.name)!.scopes[1],
          parameters: this.findTool(skill.id, tool.name)!.input_schema,
        })),
      resources: (skill.resources ?? [])
        .filter((resource) => this.findResource(skill.id, resource.id)?.audience === 'character')
        .map(resource => ({
          id: resource.id,
          description: this.findResource(skill.id, resource.id)!.description,
          audience: 'character',
          scope: this.findResource(skill.id, resource.id)!.scopes[1],
          parameters: this.findResource(skill.id, resource.id)!.input_schema ?? undefined,
        })),
      prompts: (skill.prompts ?? [])
        .filter((prompt) => this.findMethod(skill.id, prompt.id)?.audience === 'character')
        .map(prompt => ({
          id: prompt.id,
          description: this.findMethod(skill.id, prompt.id)!.description,
          audience: 'character',
          scope: this.findMethod(skill.id, prompt.id)!.scopes[1],
          parameters: this.findMethod(skill.id, prompt.id)!.instructions.kind === 'reader'
            ? (this.findMethod(skill.id, prompt.id)!.instructions as Extract<Skill['instructions'], { kind: 'reader' }>).input_schema
            : prompt.parameters,
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

/** 内部引用采用无歧义元组；既有 journal capability_id 与公开分组 ID 不重新计算。 */
function capabilityKey(groupId: string, name: string): string { return JSON.stringify([groupId, name]); }

function toolRevision(skill: SkillDescriptor, tool: SkillDescriptor['tools'][number]): string {
  // 保持已写入 journal 的定义摘要算法，切换 owner 不使旧幂等请求变成新副作用。
  return executionDigest({
    skill_id: skill.id, provider: { kind: skill.provider.kind, id: skill.provider.id },
    audience: resolveSkillAudience(skill), scope: skill.scope ?? null,
    runtime_status: skill.metadata?.runtime_status ?? null,
    skill_policy: skill.policy, tool_name: tool.name, description: tool.description,
    tool_audience: resolveToolAudience(skill, tool), tool_scope: tool.scope ?? null,
    parameters: tool.parameters ?? null, tool_policy: tool.policy ?? null,
  });
}

function readerRevision(skill: SkillDescriptor, target: NonNullable<SkillDescriptor['resources']>[number] | NonNullable<SkillDescriptor['prompts']>[number]): string {
  return executionDigest({ group_id: skill.id, provider: skill.provider, group_audience: resolveSkillAudience(skill),
    group_scope: skill.scope ?? null, runtime_status: skill.metadata?.runtime_status ?? null,
    policy: skill.policy, id: target.id, description: target.description,
    audience: target.audience ?? resolveSkillAudience(skill), scope: target.scope ?? null,
    parameters: target.parameters ?? null,
    ...('template' in target ? { template: target.template, dynamic: !!target.render } : {}),
  });
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
