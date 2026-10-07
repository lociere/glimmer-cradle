import { assertExecutionId, executionDigest, executionJson } from '../execution/invocation.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import { SkillCatalog } from '../skills/skill-catalog.js';
import { isCapabilityDefinitionVisible } from './exposure-policy.js';
import type { CapabilityDefinition } from './exposure-policy.js';
import type { CapabilityKind, ExposureGrant, StepExposureRequest, StepSurface,
  ToolSurfaceDescriptor, ResourceSurfaceDescriptor } from './step-surface.js';
import type { SkillSummary } from '../skills/skill.js';

/** 纯领域过滤/预算；App 只交入当前授权与来源事实，不把 IO/策略回调装进 Core。 */
export class ExposureController {
  public constructor(private readonly tools: ToolRegistry, private readonly skills: SkillCatalog,
    private readonly resources: ResourceRegistry) {}

  public expose(request: StepExposureRequest, grants: readonly ExposureGrant[]): StepSurface {
    for (const value of [request.run_id, request.principal_id, request.target_location]) assertExecutionId(value);
    if (request.user_id !== undefined) assertExecutionId(request.user_id);
    if (!Number.isSafeInteger(request.step) || request.step < 1
      || !Array.isArray(request.protocol_features) || !request.protocol_features.every(value => typeof value === 'string' && !!value.trim())) {
      throw new Error('Step Exposure context 无效');
    }
    if (request.scope?.user_id !== undefined && request.scope.user_id !== request.user_id) throw new Error('Step Exposure user scope 冲突');
    for (const value of [request.budget.max_definitions, request.budget.max_definition_bytes, request.budget.remaining_tool_calls]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Step Exposure budget 无效');
    }
    const tools: ToolSurfaceDescriptor[] = []; const skills: SkillSummary[] = []; const resources: ResourceSurfaceDescriptor[] = [];
    let used = 0; let count = 0; let truncated = false;
    const allowed = (kind: CapabilityKind, definition: CapabilityDefinition): boolean =>
      isCapabilityDefinitionVisible(definition, request.scope) && grants.some(grant =>
        grant.kind === kind && grant.reference.id === definition.id && grant.reference.revision === definition.revision
        && grant.principal_id === request.principal_id && grant.user_id === request.user_id
        && grant.target_location === request.target_location && typeof grant.permission_revision === 'string' && !!grant.permission_revision.trim()
        && Array.isArray(grant.required_protocol_features)
        && grant.required_protocol_features.every(feature => typeof feature === 'string' && !!feature.trim() && request.protocol_features.includes(feature)));
    const add = <T>(items: T[], value: T): void => {
      const bytes = new TextEncoder().encode(executionJson(value)).length;
      if (count >= request.budget.max_definitions || used + bytes > request.budget.max_definition_bytes) { truncated = true; return; }
      items.push(value); used += bytes; count += 1;
    };
    for (const tool of this.tools.list()) if (allowed('tool', tool)) {
      if (request.budget.remaining_tool_calls === 0) { truncated = true; continue; }
      // function name 控制在 64 字符内；revision 单独绑定，替换不偷换调用。
      add(tools, { reference: { id: tool.id, revision: tool.revision },
        name: `tool_${executionDigest({ id: tool.id }).slice(0, 56)}`, description: tool.description, input_schema: tool.input_schema });
    }
    for (const skill of this.skills.list()) if (allowed('skill', skill)) {
      add(skills, { reference: { skill_id: skill.id, definition_revision: skill.revision }, name: skill.name, description: skill.description });
    }
    for (const resource of this.resources.list()) if (allowed('resource', resource)) {
      add(resources, { reference: { id: resource.id, revision: resource.revision }, name: resource.name,
        description: resource.description, input_schema: resource.input_schema });
    }
    if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error('Exposure Tool name 冲突');
    return freeze(JSON.parse(executionJson({ run_id: request.run_id, step: request.step, tools, skills, resources,
      used_definition_bytes: used, truncated })) as StepSurface);
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
