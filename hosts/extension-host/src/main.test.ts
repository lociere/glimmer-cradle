import { describe, expect, it } from 'vitest';
import { createDisposableRegistry } from './application/extension-module';

describe('extension-host disposable registry', () => {
  it('disposes registrations in reverse order and clears the registry', async () => {
    const disposed: string[] = [];
    const registry = createDisposableRegistry();
    registry.add({ dispose: () => { disposed.push('first'); } });
    registry.add({ dispose: async () => { disposed.push('second'); } });

    await registry.disposeAll();

    expect(disposed).toEqual(['second', 'first']);
    expect(registry.size()).toBe(0);
  });
});
