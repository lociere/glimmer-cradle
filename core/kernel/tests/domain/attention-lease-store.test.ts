import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionLeaseStore } from '../../src/domain/attention/attention-lease-store';

describe('AttentionLeaseStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('把 lease 汇总为只读 attention projection，并支持释放', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-11-14T22:13:20.000Z'));
    const store = new AttentionLeaseStore();

    const lease = store.acquire({
      scene_id: 'qq:group:10001',
      channel_id: 'qq:group:10001:user:alice',
      owner: 'extension',
      owner_id: 'lociere.napcat-adapter',
      strength: 'focused',
      reason: 'active_dialogue',
      duration_ms: 60_000,
    });

    expect(lease).toMatchObject({
      lease_id: 'extension:lociere.napcat-adapter:qq%3Agroup%3A10001%3Auser%3Aalice',
      scene_id: 'qq:group:10001',
      channel_id: 'qq:group:10001:user:alice',
      owner: 'extension',
      owner_id: 'lociere.napcat-adapter',
      strength: 'focused',
      reason: 'active_dialogue',
    });
    expect(lease.expires_at).toBe('2023-11-14T22:14:20.000Z');
    expect(store.isChannelFocused('qq:group:10001:user:alice')).toBe(true);
    expect(store.getProjection()).toMatchObject({
      mode: 'focused',
      active_scene_ids: ['qq:group:10001'],
      focused_channel_ids: ['qq:group:10001:user:alice'],
    });

    expect(store.release({
      owner: 'extension',
      owner_id: 'lociere.napcat-adapter',
      channel_id: 'qq:group:10001:user:alice',
    })).toBe(true);
    expect(store.getProjection('passive')).toMatchObject({
      mode: 'passive',
      active_scene_ids: [],
      focused_channel_ids: [],
      leases: [],
    });
  });

  it('在 lease 过期时清理状态并通知 owner', () => {
    vi.useFakeTimers();
    const store = new AttentionLeaseStore();
    const changed = vi.fn();
    store.setChangeHandler(changed);

    store.acquire({
      scene_id: 'desktop:local',
      channel_id: 'desktop:local',
      owner: 'desktop',
      owner_id: 'desktop-surface',
      strength: 'focused',
      reason: 'direct_call',
      duration_ms: 100,
    });

    expect(store.hasFocusedLease()).toBe(true);
    vi.advanceTimersByTime(100);

    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'expired' }));
    expect(store.hasFocusedLease()).toBe(false);
    expect(store.getProjection()).toMatchObject({
      mode: 'idle',
      active_scene_ids: [],
      focused_channel_ids: [],
      leases: [],
    });
  });
});
