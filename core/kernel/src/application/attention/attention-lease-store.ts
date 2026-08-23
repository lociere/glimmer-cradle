import type {
  AttentionLease,
  AttentionLeaseChangeHandler,
  AttentionLeaseOwner,
  AttentionLeaseReleaseRequest,
  AttentionLeaseRequest,
  AttentionLeaseStrength,
  AttentionProjection,
  AttentionProjectionMode,
} from '../../domain/attention/attention-lease';
import type { AttentionLeasePort } from '../../ports/application-capabilities.port';
import type { KernelClockPort, ScheduledTaskPort } from '../../ports/clock.port';

export class AttentionLeaseStore implements AttentionLeasePort {
  private readonly leases = new Map<string, AttentionLease>();
  private readonly expiryTasks = new Map<string, ScheduledTaskPort>();
  private changeHandler: AttentionLeaseChangeHandler | null = null;

  public constructor(private readonly clock: KernelClockPort) {}

  public acquire(request: AttentionLeaseRequest): AttentionLease {
    const leaseId = this.makeLeaseId(request.owner, request.owner_id, request.channel_id);
    const now = request.now_ms ?? this.clock.nowMs();
    this.cancelExpiry(leaseId);

    const lease: AttentionLease = {
      lease_id: leaseId,
      scene_id: request.scene_id,
      channel_id: request.channel_id,
      actor_id: request.actor_id,
      owner: request.owner,
      owner_id: request.owner_id,
      strength: request.strength,
      reason: request.reason,
      created_at: new Date(now).toISOString(),
      expires_at: request.duration_ms !== undefined
        ? new Date(now + request.duration_ms).toISOString()
        : undefined,
    };
    this.leases.set(leaseId, lease);

    if (request.duration_ms !== undefined) {
      const task = this.clock.schedule(request.duration_ms, () => {
        const expiredLease = this.leases.get(leaseId);
        if (!expiredLease) return;
        this.leases.delete(leaseId);
        this.expiryTasks.delete(leaseId);
        this.changeHandler?.({ type: 'expired', lease: expiredLease });
      });
      this.expiryTasks.set(leaseId, task);
    }

    this.changeHandler?.({ type: 'acquired', lease });
    return lease;
  }

  public release(request: AttentionLeaseReleaseRequest): boolean {
    const leaseId = this.makeLeaseId(request.owner, request.owner_id, request.channel_id);
    const lease = this.leases.get(leaseId);
    this.cancelExpiry(leaseId);
    const released = this.leases.delete(leaseId);
    if (released && lease) this.changeHandler?.({ type: 'released', lease });
    return released;
  }

  public getProjection(baseMode: Extract<AttentionProjectionMode, 'idle' | 'passive'> = 'idle'): AttentionProjection {
    this.pruneExpired();
    const leases = Array.from(this.leases.values())
      .sort((left, right) => left.lease_id.localeCompare(right.lease_id));
    const activeSceneIds = Array.from(new Set(leases.map((lease) => lease.scene_id))).sort();
    const focusedChannelIds = Array.from(new Set(
      leases.filter((lease) => this.isFocusedLease(lease)).map((lease) => lease.channel_id),
    )).sort();

    return {
      mode: focusedChannelIds.length > 0 ? 'focused' : leases.length > 0 ? 'active' : baseMode,
      active_scene_ids: activeSceneIds,
      focused_channel_ids: focusedChannelIds,
      leases,
    };
  }

  public isChannelFocused(channelId: string): boolean {
    this.pruneExpired();
    return Array.from(this.leases.values()).some(
      (lease) => lease.channel_id === channelId && this.isFocusedLease(lease),
    );
  }

  public hasFocusedLease(): boolean {
    this.pruneExpired();
    return Array.from(this.leases.values()).some((lease) => this.isFocusedLease(lease));
  }

  public setChangeHandler(handler: AttentionLeaseChangeHandler | null): void {
    this.changeHandler = handler;
  }

  public clear(): void {
    for (const task of this.expiryTasks.values()) task.cancel();
    this.expiryTasks.clear();
    this.leases.clear();
    this.changeHandler = null;
  }

  private makeLeaseId(owner: AttentionLeaseOwner, ownerId: string, channelId: string): string {
    return [owner, ownerId, channelId].map(encodeURIComponent).join(':');
  }

  private cancelExpiry(leaseId: string): void {
    this.expiryTasks.get(leaseId)?.cancel();
    this.expiryTasks.delete(leaseId);
  }

  private isFocusedLease(lease: AttentionLease): boolean {
    return lease.strength === 'focused' || lease.strength === 'pinned';
  }

  private pruneExpired(nowMs: number = this.clock.nowMs()): void {
    for (const [leaseId, lease] of this.leases.entries()) {
      if (!lease.expires_at) continue;
      const expiresAtMs = Date.parse(lease.expires_at);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
        this.leases.delete(leaseId);
        this.cancelExpiry(leaseId);
      }
    }
  }
}
