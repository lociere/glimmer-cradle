export type AttentionLeaseOwner = "desktop" | "extension" | "system";
export type AttentionLeaseStrength = "background" | "watching" | "focused" | "pinned";
export type AttentionLeaseReason = "direct_call" | "wake_word" | "active_dialogue" | "manual_pin" | "system";
export type AttentionProjectionMode = "idle" | "passive" | "active" | "focused";

export interface AttentionLease {
  lease_id: string;
  scene_id: string;
  channel_id: string;
  actor_id?: string;
  owner: AttentionLeaseOwner;
  owner_id: string;
  strength: AttentionLeaseStrength;
  reason: AttentionLeaseReason;
  created_at: string;
  expires_at?: string;
}

export interface AttentionProjection {
  mode: AttentionProjectionMode;
  active_scene_ids: string[];
  focused_channel_ids: string[];
  leases: AttentionLease[];
}

export interface AttentionLeaseRequest {
  scene_id: string;
  channel_id: string;
  actor_id?: string;
  owner: AttentionLeaseOwner;
  owner_id: string;
  strength: AttentionLeaseStrength;
  reason: AttentionLeaseReason;
  duration_ms?: number;
  now_ms?: number;
}

export interface AttentionLeaseReleaseRequest {
  owner: AttentionLeaseOwner;
  owner_id: string;
  channel_id: string;
}

export interface AttentionLeaseChange {
  type: "acquired" | "released" | "expired";
  lease: AttentionLease;
}

export type AttentionLeaseChangeHandler = (change: AttentionLeaseChange) => void;

export class AttentionLeaseStore {
  private static _instance: AttentionLeaseStore | null = null;
  private readonly _leases: Map<string, AttentionLease> = new Map();
  private readonly _timers: Map<string, NodeJS.Timeout> = new Map();
  private _changeHandler: AttentionLeaseChangeHandler | null = null;

  public static get instance(): AttentionLeaseStore {
    if (!AttentionLeaseStore._instance) {
      AttentionLeaseStore._instance = new AttentionLeaseStore();
    }
    return AttentionLeaseStore._instance;
  }

  public acquire(request: AttentionLeaseRequest): AttentionLease {
    const leaseId = this.makeLeaseId(request.owner, request.owner_id, request.channel_id);
    const now = request.now_ms ?? Date.now();
    this.clearTimer(leaseId);

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
    this._leases.set(leaseId, lease);

    if (request.duration_ms !== undefined) {
      const timer = setTimeout(() => {
        const expiredLease = this._leases.get(leaseId);
        if (!expiredLease) return;
        this._leases.delete(leaseId);
        this._timers.delete(leaseId);
        this._changeHandler?.({ type: "expired", lease: expiredLease });
      }, request.duration_ms);
      this._timers.set(leaseId, timer);
    }

    this._changeHandler?.({ type: "acquired", lease });
    return lease;
  }

  public release(request: AttentionLeaseReleaseRequest): boolean {
    const leaseId = this.makeLeaseId(request.owner, request.owner_id, request.channel_id);
    const lease = this._leases.get(leaseId);
    this.clearTimer(leaseId);
    const released = this._leases.delete(leaseId);
    if (released && lease) {
      this._changeHandler?.({ type: "released", lease });
    }
    return released;
  }

  public getProjection(baseMode: Extract<AttentionProjectionMode, "idle" | "passive"> = "idle"): AttentionProjection {
    this.pruneExpired();
    const leases = Array.from(this._leases.values())
      .sort((left, right) => left.lease_id.localeCompare(right.lease_id));
    const activeSceneIds = Array.from(new Set(leases.map((lease) => lease.scene_id))).sort();
    const focusedChannelIds = Array.from(new Set(
      leases
        .filter((lease) => this.isFocusedLease(lease))
        .map((lease) => lease.channel_id),
    )).sort();

    const mode: AttentionProjectionMode =
      focusedChannelIds.length > 0
        ? "focused"
        : leases.length > 0
        ? "active"
        : baseMode;

    return {
      mode,
      active_scene_ids: activeSceneIds,
      focused_channel_ids: focusedChannelIds,
      leases,
    };
  }

  public isChannelFocused(channelId: string): boolean {
    this.pruneExpired();
    return Array.from(this._leases.values()).some(
      (lease) => lease.channel_id === channelId && this.isFocusedLease(lease),
    );
  }

  public hasFocusedLease(): boolean {
    this.pruneExpired();
    return Array.from(this._leases.values()).some((lease) => this.isFocusedLease(lease));
  }

  public setChangeHandler(handler: AttentionLeaseChangeHandler | null): void {
    this._changeHandler = handler;
  }

  public clear(): void {
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
    }
    this._timers.clear();
    this._leases.clear();
    this._changeHandler = null;
  }

  private makeLeaseId(owner: AttentionLeaseOwner, ownerId: string, channelId: string): string {
    return [owner, ownerId, channelId].map(encodeURIComponent).join(":");
  }

  private clearTimer(leaseId: string): void {
    const existing = this._timers.get(leaseId);
    if (!existing) return;
    clearTimeout(existing);
    this._timers.delete(leaseId);
  }

  private isFocusedLease(lease: AttentionLease): boolean {
    return lease.strength === "focused" || lease.strength === "pinned";
  }

  private pruneExpired(nowMs: number = Date.now()): void {
    for (const [leaseId, lease] of this._leases.entries()) {
      if (!lease.expires_at) continue;
      const expiresAtMs = Date.parse(lease.expires_at);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
        this._leases.delete(leaseId);
        this.clearTimer(leaseId);
      }
    }
  }
}
