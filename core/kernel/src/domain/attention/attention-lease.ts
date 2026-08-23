export type AttentionLeaseOwner = 'desktop' | 'extension' | 'system';
export type AttentionLeaseStrength = 'background' | 'watching' | 'focused' | 'pinned';
export type AttentionLeaseReason = 'direct_call' | 'wake_word' | 'active_dialogue' | 'manual_pin' | 'system';
export type AttentionProjectionMode = 'idle' | 'passive' | 'active' | 'focused';

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
  type: 'acquired' | 'released' | 'expired';
  lease: AttentionLease;
}

export type AttentionLeaseChangeHandler = (change: AttentionLeaseChange) => void;
