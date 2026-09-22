import { describe, expect, it, vi } from 'vitest';

import {
  InteractionController,
  type InteractionInput,
  type TurnProcessorPort,
} from '../src/index';

function input(
  inputId: string,
  deduplicationKey: string,
  payloadDigest: string,
): InteractionInput<{ text: string }> {
  return {
    input_id: inputId,
    deduplication_key: deduplicationKey,
    payload_digest: payloadDigest,
    received_at: '2026-01-01T00:00:00Z',
    payload: { text: inputId },
    conversation: {
      source_provider_id: 'test',
      scene_id: 'scene:test',
      conversation_id: 'conversation:test',
      continuity_id: 'continuity:test',
      thread_id: 'main',
      interaction_id: inputId,
      recall_scope: 'conversation_private',
      disclosure_scope: 'conversation_private',
    },
  };
}

describe('Interaction admission', () => {
  it('deduplicates completed inputs and rejects key reuse with different content', async () => {
    const process = vi.fn(async (value: InteractionInput, generation: number) => ({
      turn_id: value.conversation.interaction_id,
      generation,
      status: 'completed' as const,
    }));
    const controller = new InteractionController({ process });
    const firstInput = input('turn:1', 'source:event:1', 'sha256:first');

    const first = await controller.accept(firstInput);
    const replay = await controller.accept(firstInput);
    const conflict = await controller.accept({
      ...firstInput,
      input_id: 'turn:other',
      payload_digest: 'sha256:changed',
      conversation: { ...firstInput.conversation, interaction_id: 'turn:other' },
    });

    expect(first.snapshot?.status).toBe('completed');
    expect(replay).toMatchObject({ accepted: true, duplicate: true, snapshot: first.snapshot });
    expect(conflict).toMatchObject({ accepted: false, duplicate: false, reason: 'conflict' });
    expect(process).toHaveBeenCalledOnce();
  });

  it('releases failed admission so the same durable input can retry', async () => {
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockImplementationOnce(async (value: InteractionInput, generation: number) => ({
        turn_id: value.conversation.interaction_id,
        generation,
        status: 'completed' as const,
      }));
    const controller = new InteractionController({ process });
    const value = input('turn:retry', 'source:event:retry', 'sha256:retry');

    await expect(controller.accept(value)).rejects.toThrow('temporary');
    await expect(controller.accept(value)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      snapshot: { status: 'completed' },
    });
    expect(process).toHaveBeenCalledTimes(2);
  });

  it('invalidates a late result after a newer input interrupts the route', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const processor: TurnProcessorPort<{ text: string }> = {
      process: vi.fn(async (value, generation) => {
        if (value.input_id === 'turn:first') await firstBlocked;
        return { turn_id: value.input_id, generation, status: 'completed' as const };
      }),
    };
    const controller = new InteractionController(processor);

    const firstPromise = controller.accept(input('turn:first', 'source:first', 'sha256:first'));
    await Promise.resolve();
    const second = await controller.accept(input('turn:second', 'source:second', 'sha256:second'));
    releaseFirst();
    const first = await firstPromise;

    expect(second.snapshot).toMatchObject({ status: 'completed', generation: 2 });
    expect(first.snapshot).toMatchObject({
      status: 'interrupted',
      generation: 1,
      terminal_reason: 'stale_generation',
    });
  });
});
