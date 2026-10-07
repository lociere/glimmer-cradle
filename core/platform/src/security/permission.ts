import { validateSecurityIdentity } from './principal.js';

/** 细粒度权限请求；Platform 不解释 resource 内容或 capability scope。 */
export interface PermissionRequest {
  readonly principal_id: string;
  readonly host_id: string;
  readonly generation: string;
  readonly permission: string;
  readonly resource_id: string;
  readonly resource_revision: string;
  readonly target_location: string;
}

export interface PermissionGrant extends PermissionRequest {
  readonly grant_id: string;
  readonly permission_revision: string;
  readonly expires_at_ms: number;
}

export type PermissionDecision =
  | { readonly allowed: true; readonly grant: PermissionGrant }
  | { readonly allowed: false; readonly reason: 'principal_inactive' | 'permission_denied' | 'permission_expired' };

export function snapshotPermissionRequest(value: PermissionRequest): PermissionRequest {
  for (const id of [value.principal_id, value.host_id, value.generation, value.permission,
    value.resource_id, value.resource_revision, value.target_location]) validateSecurityIdentity(id);
  return Object.freeze({ principal_id: value.principal_id, host_id: value.host_id, generation: value.generation,
    permission: value.permission, resource_id: value.resource_id, resource_revision: value.resource_revision,
    target_location: value.target_location });
}
