import { describe, expect, it, vi } from 'vitest';

import { ApplicationRuntime } from './application-runtime';

describe('ApplicationRuntime resource lifecycle', () => {
  it('releases owned resources and detaches the action handler when a provider stop fails', async () => {
    const close = vi.fn();
    const setCognitionActionHandler = vi.fn();
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler,
      logger: { debug: vi.fn() } as never,
      skillProviders: [{
        start: vi.fn(),
        stop: vi.fn(() => { throw new Error('provider stop failed'); }),
        listSkills: () => [],
      }] as never,
      providerReadiness: () => [],
      extensionHostService: {} as never,
      skillCatalog: {} as never,
      skillPlanning: {} as never,
      skillAction: {} as never,
      perception: {} as never,
      ownedResources: [{ close }],
    });

    await expect(runtime.stop({} as never)).rejects.toThrow(
      'Application Runtime 停止时存在资源释放失败',
    );
    expect(close).toHaveBeenCalledOnce();
    expect(setCognitionActionHandler).toHaveBeenLastCalledWith(null);
  });
});
