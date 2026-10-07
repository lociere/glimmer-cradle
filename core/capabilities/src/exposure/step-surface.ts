import type { CapabilityScopeContext } from './exposure-policy.js';
import type { SkillSummary } from '../skills/skill.js';

export type CapabilityKind = 'tool' | 'skill' | 'resource';
export interface CapabilityReference {
  readonly id: string;
  readonly revision: string;
}

/** App/broker 提供的授权事实，不来自模型；只对一个定义版本和主体/位置有效。 */
export interface ExposureGrant {
  readonly kind: CapabilityKind;
  readonly reference: CapabilityReference;
  readonly principal_id: string;
  readonly user_id?: string;
  readonly target_location: string;
  readonly permission_revision: string;
  readonly required_protocol_features: readonly string[];
}

export interface StepExposureRequest {
  readonly run_id: string;
  readonly step: number;
  readonly principal_id: string;
  readonly user_id?: string;
  readonly target_location: string;
  readonly scope?: CapabilityScopeContext;
  readonly protocol_features: readonly string[];
  readonly budget: {
    readonly max_definitions: number;
    readonly max_definition_bytes: number;
    readonly remaining_tool_calls: number;
  };
}

export interface ToolSurfaceDescriptor {
  readonly reference: CapabilityReference;
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
}
export interface ResourceSurfaceDescriptor {
  readonly reference: CapabilityReference;
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
}

/** 一次 Step 的有界投影；不是注册表、权限令牌或执行结果。 */
export interface StepSurface {
  readonly run_id: string;
  readonly step: number;
  readonly tools: readonly ToolSurfaceDescriptor[];
  readonly skills: readonly SkillSummary[];
  readonly resources: readonly ResourceSurfaceDescriptor[];
  readonly used_definition_bytes: number;
  readonly truncated: boolean;
}
