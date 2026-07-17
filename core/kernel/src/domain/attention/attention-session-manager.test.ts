import { describe, expect, it } from 'vitest';
import type { PerceptionEvent } from '@glimmer-cradle/protocol';
import { AttentionSessionManager } from './attention-session-manager';

function perception(overrides: Partial<PerceptionEvent> = {}): PerceptionEvent {
  const id = overrides.id ?? 'event-1';
  return {
    id,
    trace_id: overrides.trace_id ?? id,
    sensoryType: 'text',
    source: 'desktop-ui:user',
    timestamp: 1,
    familiarity: 10,
    address_mode: 'direct',
    response_policy: 'reply_allowed',
    conversation: {
      source_provider_id: 'desktop-ui',
      scene_id: 'scene:desktop:local',
      conversation_id: 'conversation:desktop:local',
      continuity_id: 'continuity:desktop:user',
      thread_id: 'main',
      interaction_id: id,
      recall_scope: 'conversation_private',
      disclosure_scope: 'conversation_private',
    },
    origin: {
      provider_kind: 'user',
      provider_id: 'desktop-ui',
      source_event_id: id,
      schema_ref: 'glimmer://desktop/text-input/v1',
      trust_tier: 'user_asserted',
      privacy_class: 'private',
      cognitive_effect: 'observation',
    },
    retention_ceiling: 'memory_candidate',
    content: {
      text: '测试输入',
      modality: ['text'],
      actor_id: 'desktop-ui:user',
      actor_name: '本地用户',
    },
    ...overrides,
  };
}

describe('AttentionSessionManager 感知契约', () => {
  it('批处理后保留权威 PerceptionEvent 的 trace、来源和留存上限', () => {
    const manager = AttentionSessionManager.instance as unknown as {
      mergeRequests(requests: PerceptionEvent[]): PerceptionEvent;
    };
    const event = perception();

    const merged = manager.mergeRequests([event]);

    expect(merged.trace_id).toBe(event.trace_id);
    expect(merged.origin).toEqual(event.origin);
    expect(merged.retention_ceiling).toBe('memory_candidate');
  });

  it('合并不同留存上限时采用最严格上限', () => {
    const manager = AttentionSessionManager.instance as unknown as {
      mergeRequests(requests: PerceptionEvent[]): PerceptionEvent;
    };

    const merged = manager.mergeRequests([
      perception({ id: 'event-1', retention_ceiling: 'memory_candidate' }),
      perception({ id: 'event-2', retention_ceiling: 'transient' }),
    ]);

    expect(merged.retention_ceiling).toBe('transient');
  });
});
