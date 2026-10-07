import { randomUUID } from 'node:crypto';
import { snapshotPrincipal, snapshotPermissionRequest } from '@glimmer-cradle/platform';
import type { Principal, PermissionRequest, PermissionGrant, PermissionDecision } from '@glimmer-cradle/platform';

export interface PermissionAudit {
  readonly action: 'principal_registered' | 'principal_revoked' | 'permission_granted' | 'permission_revoked' | 'permission_checked';
  readonly principal_id: string;
  readonly grant_id?: string;
  readonly allowed?: boolean;
  readonly permission_revision?: string;
}

/** 只接纳 Host 明确授予的短寿命授权；manifest/模型/SDK 请求不是授权事实。
 * 状态是本实例运行期能力，重启不恢复旧 grant；持久用户授权配置/UI 仍由后续 Host 装配拥有。
 */
export class PermissionBroker {
  private readonly principals = new Map<string, Principal>();
  private readonly grants = new Map<string, PermissionGrant>();
  private readonly revocations = new Set<(principalId: string, grantId?: string) => void>();
  private readonly bootId = randomUUID();
  private revision = 0;
  private lastTime = 0;
  public constructor(private readonly now: () => number, private readonly audit: (event: PermissionAudit) => void) {}

  public registerPrincipal(value: Principal): Principal {
    const principal = snapshotPrincipal(value);
    if (this.principals.has(principal.principal_id)) throw new Error('Principal 已登记，必须先撤销旧实例');
    this.audit({ action: 'principal_registered', principal_id: principal.principal_id });
    this.principals.set(principal.principal_id, principal);
    return principal;
  }
  public grant(value: PermissionRequest, expiresAtMs: number): PermissionGrant {
    const request = snapshotPermissionRequest(value);
    if (!this.current(request)) throw new Error('授权主体未由 Host 登记');
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= this.time()) throw new Error('授权期限无效');
    if (this.grants.size >= 4096) throw new Error('Host 授权预算耗尽');
    const grant = Object.freeze({ ...request, grant_id: randomUUID(),
      permission_revision: `${this.bootId}:${++this.revision}`, expires_at_ms: expiresAtMs });
    this.audit({ action: 'permission_granted', principal_id: request.principal_id,
      grant_id: grant.grant_id, permission_revision: grant.permission_revision });
    this.grants.set(grant.grant_id, grant);
    return grant;
  }
  public authorize(value: PermissionRequest): PermissionDecision {
    const request = snapshotPermissionRequest(value);
    let decision: PermissionDecision = { allowed: false, reason: 'permission_denied' };
    if (!this.current(request)) decision = { allowed: false, reason: 'principal_inactive' };
    else {
      const now = this.time();
      for (const grant of this.grants.values()) {
        if (Object.keys(request).every(key => request[key as keyof PermissionRequest] === grant[key as keyof PermissionRequest])) {
          if (grant.expires_at_ms <= now) decision = { allowed: false, reason: 'permission_expired' };
          else { decision = { allowed: true, grant }; break; }
        }
      }
    }
    this.audit({ action: 'permission_checked', principal_id: request.principal_id, allowed: decision.allowed,
      ...(decision.allowed ? { grant_id: decision.grant.grant_id, permission_revision: decision.grant.permission_revision } : {}) });
    return decision;
  }
  public isCurrent(grant: PermissionGrant): boolean {
    return this.grants.get(grant.grant_id) === grant && this.current(grant) && grant.expires_at_ms > this.time();
  }
  public revokeGrant(grantId: string): boolean {
    const grant = this.grants.get(grantId);
    if (!grant) return false;
    this.grants.delete(grantId); this.notify(grant.principal_id, grantId);
    this.audit({ action: 'permission_revoked', principal_id: grant.principal_id, grant_id: grantId });
    return true;
  }
  public revokePrincipal(principalId: string): boolean {
    if (!this.principals.has(principalId)) return false;
    // 撤销不能因审计故障继续放行：先去能力，审计失败由调用 owner 如实报告。
    this.principals.delete(principalId);
    for (const [id, grant] of this.grants) if (grant.principal_id === principalId) this.grants.delete(id);
    this.notify(principalId);
    this.audit({ action: 'principal_revoked', principal_id: principalId });
    return true;
  }
  public onRevoked(listener: (principalId: string, grantId?: string) => void): () => void {
    this.revocations.add(listener); return () => this.revocations.delete(listener);
  }
  private current(request: PermissionRequest): boolean {
    const principal = this.principals.get(request.principal_id);
    return !!principal && principal.host_id === request.host_id && principal.generation === request.generation;
  }
  private time(): number {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Host 权限时钟无效');
    // 墙钟回拨不能重新激活已经到期的能力。
    this.lastTime = Math.max(this.lastTime, now);
    return this.lastTime;
  }
  private notify(principal: string, grant?: string): void {
    for (const listener of this.revocations) { try { listener(principal, grant); } catch { /* 撤销不依赖观察者成功。 */ } }
  }
}
