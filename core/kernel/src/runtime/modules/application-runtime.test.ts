import { describe, expect, it, vi } from 'vitest';

import { ApplicationRuntime } from './application-runtime';
import { App } from '../../composition/kernel-application';

describe('ApplicationRuntime resource lifecycle', () => {
  it.each(['transport', 'application'])('%s 启动失败也关闭装配时已打开、尚未进 started 栈的资源', async (phase) => {
    const close = vi.fn();
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: vi.fn(), logger: { debug: vi.fn() } as never,
      skillProviders: [{ start: () => { if (phase === 'application') throw new Error('provider failed'); },
        stop: vi.fn(), listSkills: () => [] }] as never,
      providerReadiness: () => [], extensionHostService: {} as never, skillCatalog: {} as never,
      skillPlanning: {} as never, skillAction: {} as never, perception: {} as never, ownedResources: [{ close }],
    });
    const logger = { debug: vi.fn(), info: vi.fn() };
    const app = new App(logger as never, { createTraceContext: () => ({ trace_id: 'test' }), close: vi.fn() } as never,
      { publish: vi.fn(), shutdown: vi.fn() } as never,
      { replaceModuleSnapshots: vi.fn(), clear: vi.fn() } as never, { monotonicNowMs: () => 1 } as never,
      { name: 'bootstrap', start: vi.fn(), stop: vi.fn(), config: {} } as never,
      () => ({ application: runtime, transport: { name: 'transport',
        start: () => { if (phase === 'transport') throw new Error('transport failed'); }, stop: vi.fn(),
        closeIngress: vi.fn(), openIngress: vi.fn() }, presentation: [], coreReadiness: [] }) as never);
    await expect(app.start()).rejects.toThrow('应用启动失败');
    expect(close).toHaveBeenCalledOnce();
  });
  it('先断开 handler，再等待执行排空，最后卸载 provider/关闭 journal', async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: () => { order.push('detach'); }, logger: { debug: vi.fn() } as never,
      skillProviders: [{ stop: () => { order.push('provider'); }, listSkills: () => [] }] as never,
      providerReadiness: () => [], extensionHostService: {} as never, skillCatalog: {} as never,
      skillPlanning: {} as never, skillAction: {} as never, perception: {} as never,
      drainExecution: async () => { order.push('drain'); await blocked; order.push('drained'); },
      ownedResources: [{ close: () => { order.push('close'); } }],
    });
    const stopping = runtime.stop({} as never);
    await Promise.resolve(); expect(order).toEqual(['detach', 'drain']);
    release(); await stopping; expect(order).toEqual(['detach', 'drain', 'drained', 'provider', 'close']);
  });
  it('排空失败时保留 provider 和 journal，不能假装完成释放', async () => {
    const close = vi.fn(); const stop = vi.fn();
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: vi.fn(), logger: { debug: vi.fn() } as never,
      skillProviders: [{ stop, listSkills: () => [] }] as never, providerReadiness: () => [],
      extensionHostService: {} as never, skillCatalog: {} as never, skillPlanning: {} as never,
      skillAction: {} as never, perception: {} as never, ownedResources: [{ close }],
      drainExecution: async () => { throw new Error('drain failed'); },
    });
    await expect(runtime.stop({} as never)).rejects.toThrow('drain failed');
    expect(stop).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
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
