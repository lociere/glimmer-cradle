import { describe, expect, it, vi } from 'vitest';

import { ApplicationRuntime } from './application-runtime';
import { App } from '../../composition/kernel-application';
import { AppLifecycleState } from '../../domain/lifecycle/lifecycle-state.enum';
import { SqliteExecutionJournal } from '@glimmer-cradle/capabilities';
import { SystemClock, type Clock } from '@glimmer-cradle/platform';

describe('ApplicationRuntime resource lifecycle', () => {
  function manualClock() {
    let now = 0;
    const timers = new Set<{ at: number; task: () => void }>();
    return {
      nowMs: () => 1_000_000, monotonicNowMs: () => now,
      schedule(ms: number, task: () => void) { const timer = { at: now + ms, task }; timers.add(timer); return { cancel: () => { timers.delete(timer); } }; },
      advance(ms: number) { now += ms; for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.task(); } },
      timers,
    };
  }
  function controlledApp(options: {
    startGate?: Promise<void>; stopGate?: Promise<void>; stopError?: () => boolean; eventError?: boolean;
    application?: ApplicationRuntime; transportError?: boolean;
    onPublish?: (type: string) => void | Promise<void>; onCloseIngress?: () => void | Promise<void>;
    clock?: Clock; startTimeoutMs?: number; stopTimeoutMs?: number;
    bootstrapGate?: Promise<void>;
    onConstruct?: () => void;
  } = {}) {
    const order: string[] = [];
    const module = (name: string) => ({ name,
      async start() { order.push(`start:${name}`); if (name === 'bootstrap') await options.bootstrapGate; if (name === 'transport') {
        await options.startGate; if (options.transportError) throw new Error('transport failed');
      } },
      async stop() { order.push(`stop:${name}`); if (name === 'application') {
        await options.stopGate; if (options.stopError?.()) throw new Error('application stop failed');
      } },
    });
    const openIngress = vi.fn(() => { order.push('open'); });
    const app = new App({ debug: vi.fn(), info: vi.fn() } as never,
      { createTraceContext: () => ({ trace_id: 'test' }), histogram: vi.fn(),
        close: () => { order.push('observability-close'); } } as never,
      { publish: (event: { type: string }) => {
        order.push(event.type);
        if (options.eventError && event.type === 'AppStoppingEvent') throw new Error('stopping observer failed');
        return options.onPublish?.(event.type);
      }, shutdown: () => { order.push('eventbus-close'); } } as never,
      { replaceModuleSnapshots: vi.fn(), clear: vi.fn() } as never, options.clock ?? new SystemClock(),
      { ...module('bootstrap'), config: { system: { lifecycle: { start_timeout_ms: options.startTimeoutMs ?? 30000, stop_timeout_ms: options.stopTimeoutMs ?? 30000 } } } } as never,
      () => { options.onConstruct?.(); return { transport: { ...module('transport'), openIngress, closeIngress: () => {
        order.push('close-ingress'); return options.onCloseIngress?.();
      } },
        application: options.application ?? module('application'), presentation: [module('presentation')], coreReadiness: [],
        organism: module('organism'), recovery: module('recovery') } as never; });
    return { app, order, openIngress };
  }

  it('elapsed foundation time cannot refresh the configured startup budget or admit further resource construction', async () => {
    const clock = manualClock();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const construct = vi.fn();
    const { app, order, openIngress } = controlledApp({ clock, bootstrapGate: gate, startTimeoutMs: 100, onConstruct: construct });
    const outcome = expect(app.start()).rejects.toThrow('拒绝装配后续资源');
    await new Promise<void>(resolve => setImmediate(resolve));
    clock.advance(150); release(); await outcome;
    expect(order.filter(event => event.startsWith('start:'))).toEqual(['start:bootstrap']);
    expect(order.filter(event => event.startsWith('stop:'))).toEqual(['stop:bootstrap']);
    expect(construct).not.toHaveBeenCalled();
    expect(openIngress).not.toHaveBeenCalled(); expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(clock.timers.size).toBe(0);
  });

  it('configured startup expiry keeps the actual pending module until a later stop joins its release', async () => {
    const clock = manualClock();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const construct = vi.fn();
    const { app, order, openIngress } = controlledApp({ clock, startGate: gate, startTimeoutMs: 100, stopTimeoutMs: 30, onConstruct: construct });
    const outcome = expect(app.start()).rejects.toThrow('应用启动失败');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(order).toContain('start:transport');
    expect(construct).toHaveBeenCalledOnce();
    clock.advance(100); await new Promise<void>(resolve => setImmediate(resolve));
    clock.advance(30); await outcome;
    expect(app.state).toBe(AppLifecycleState.ERROR); expect(openIngress).not.toHaveBeenCalled();
    expect(order).not.toContain('stop:transport'); expect(order).not.toContain('stop:bootstrap');
    expect(order).not.toContain('eventbus-close'); expect(order).not.toContain('observability-close');
    release(); await app.stop();
    expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(order.filter(event => event === 'stop:transport')).toHaveLength(1);
    expect(order.filter(event => event === 'stop:bootstrap')).toHaveLength(1);
    expect(clock.timers.size).toBe(0);
  });

  it('configured stop expiry preserves the actual provider and SQLite dependency, retry joins without duplicate stop', async () => {
    const clock = manualClock(), journal = new SqliteExecutionJournal(':memory:');
    const close = vi.spyOn(journal, 'close');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const stopProvider = vi.fn(async () => { await gate; expect(journal.readOutbox(1)).toEqual([]); });
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: vi.fn(), logger: { debug: vi.fn() } as never,
      skillProviders: [{ start: vi.fn(), stop: stopProvider, listSkills: () => [] }] as never,
      providerReadiness: () => [], extensionHostService: {} as never, skillCatalog: {} as never,
      skillPlanning: {} as never, skillAction: {} as never, perception: {} as never, ownedResources: [journal],
    });
    const { app, order } = controlledApp({ clock, application: runtime, stopTimeoutMs: 30 });
    try {
      await app.start();
      const stopping = app.stop(); expect(app.stop()).toBe(stopping);
      const outcome = expect(stopping).rejects.toThrow('应用停止时存在资源释放失败');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(stopProvider).toHaveBeenCalledOnce();
      clock.advance(30); await outcome;
      expect(close).not.toHaveBeenCalled(); expect(journal.readOutbox(1)).toEqual([]);
      expect(order).not.toContain('stop:transport'); expect(order).not.toContain('eventbus-close');
      const retry = app.stop(); release(); await retry;
      expect(stopProvider).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
      expect(app.state).toBe(AppLifecycleState.STOPPED); expect(clock.timers.size).toBe(0);
    } finally { release(); await app.stop().catch(() => undefined); if (!close.mock.calls.length) journal.close(); }
  });

  it('a delayed final stop observer keeps diagnostics alive even after every module owner released', async () => {
    const clock = manualClock();
    let release!: () => void, stopped = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { app, order } = controlledApp({ clock, stopTimeoutMs: 30, onPublish: type => {
      if (type === 'ModuleStoppedEvent' && ++stopped === 6) return gate;
    } });
    await app.start();
    const outcome = expect(app.stop()).rejects.toThrow('应用停止时存在资源释放失败');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toBe(6);
    clock.advance(30); await outcome;
    expect(order.filter(event => event.startsWith('stop:'))).toHaveLength(6);
    expect(order).not.toContain('AppStoppedEvent'); expect(order).not.toContain('eventbus-close');
    expect(order).not.toContain('observability-close');
    release(); await app.stop();
    expect(app.state).toBe(AppLifecycleState.STOPPED); expect(stopped).toBe(6);
    expect(order.slice(-3)).toEqual(['AppStoppedEvent', 'eventbus-close', 'observability-close']);
  });

  it('root stopping observer expiry keeps module dependencies and retries the same actual root operation', async () => {
    const clock = manualClock();
    let release!: () => void, published = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { app, order } = controlledApp({ clock, stopTimeoutMs: 30, onPublish: type => {
      if (type === 'AppStoppingEvent') { published++; return gate; }
    } });
    await app.start();
    const outcome = expect(app.stop()).rejects.toThrow('应用停止时存在资源释放失败');
    await new Promise<void>(resolve => setImmediate(resolve));
    clock.advance(30); await outcome;
    expect(order.filter(event => event.startsWith('stop:'))).toHaveLength(0);
    expect(order).not.toContain('AppStoppedEvent'); expect(order).not.toContain('eventbus-close');
    const retry = app.stop(); expect(app.stop()).toBe(retry);
    release(); await retry;
    expect(published).toBe(1); expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(order.filter(event => event.startsWith('stop:'))).toHaveLength(6);
    expect(clock.timers.size).toBe(0);
  });

  it('root startup observer expiry retains its actual callback and refuses dependency release until it settles', async () => {
    const clock = manualClock();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { app, order } = controlledApp({ clock, startTimeoutMs: 100, stopTimeoutMs: 30, onPublish: type => {
      if (type === 'AppStartedEvent') return gate;
    } });
    const outcome = expect(app.start()).rejects.toThrow('应用启动失败');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(order).toContain('AppStartedEvent');
    clock.advance(100); await new Promise<void>(resolve => setImmediate(resolve));
    clock.advance(30); await outcome;
    expect(app.state).toBe(AppLifecycleState.ERROR);
    expect(order).toContain('close-ingress');
    expect(order.filter(event => event.startsWith('stop:'))).toHaveLength(0);
    expect(order).not.toContain('AppStoppedEvent'); expect(order).not.toContain('observability-close');
    const retry = app.stop(); release(); await retry;
    expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(order.filter(event => event.startsWith('stop:'))).toHaveLength(6);
    expect(clock.timers.size).toBe(0);
  });

  it('a late root stop failure remains observable after timeout without repeating the same root callback', async () => {
    const clock = manualClock();
    let release!: () => void, published = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { app, order } = controlledApp({ clock, stopTimeoutMs: 30, onPublish: async type => {
      if (type === 'AppStoppingEvent') { published++; await gate; throw new Error('actual late root observer failed'); }
    } });
    await app.start();
    const first = expect(app.stop()).rejects.toThrow('应用停止时存在资源释放失败');
    await new Promise<void>(resolve => setImmediate(resolve));
    clock.advance(30); await first;
    release(); await new Promise<void>(resolve => setImmediate(resolve));
    await expect(app.stop()).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'actual late root observer failed' })] });
    expect(published).toBe(1); expect(app.state).toBe(AppLifecycleState.ERROR);
    expect(order.filter(event => event.startsWith('stop:'))).toHaveLength(6);
  });

  it('App stops every resource and closes diagnostics despite product stopping observer failure', async () => {
    const { app, order } = controlledApp({ eventError: true });
    await app.start();
    await expect(app.stop()).rejects.toThrow('应用停止时存在资源释放失败');
    expect(order.filter(value => value.startsWith('stop:'))).toEqual([
      'stop:recovery', 'stop:organism', 'stop:presentation', 'stop:application', 'stop:transport', 'stop:bootstrap',
    ]);
    expect(order.slice(-2)).toEqual(['eventbus-close', 'observability-close']);
    expect(app.state).toBe(AppLifecycleState.ERROR);
  });

  it('App concurrent stop waits for actual drain and preserves failed ownership for retry', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let failStop = true;
    const { app, order } = controlledApp({ stopGate: gate, stopError: () => failStop });
    await app.start();
    const stop = app.stop();
    expect(app.stop()).toBe(stop);
    expect(app.state).toBe(AppLifecycleState.STOPPING);
    const outcome = expect(stop).rejects.toThrow('应用停止时存在资源释放失败');
    release(); await outcome;
    expect(app.state).toBe(AppLifecycleState.ERROR);
    expect(order).not.toContain('eventbus-close');
    expect(order).not.toContain('observability-close');
    expect(order.filter(value => value.startsWith('stop:'))).toHaveLength(6);
    failStop = false;
    await app.stop();
    expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(order.filter(value => value === 'stop:application')).toHaveLength(2);
    expect(order.filter(value => value === 'stop:transport')).toHaveLength(1);
    expect(order.slice(-3)).toEqual(['AppStoppedEvent', 'eventbus-close', 'observability-close']);
  });

  it('App stop during startup drains accepted module and cannot reopen ingress or enter running', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { app, order, openIngress } = controlledApp({ startGate: gate });
    const starting = app.start();
    const outcome = expect(starting).rejects.toThrow('应用启动失败');
    for (let tick = 0; tick < 50 && !order.includes('start:transport'); tick += 1) await Promise.resolve();
    expect(order).toContain('start:transport');
    const stopping = app.stop();
    release();
    await outcome; await stopping;
    expect(openIngress).not.toHaveBeenCalled();
    expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(order.filter(value => value.startsWith('start:'))).toEqual(['start:bootstrap', 'start:transport']);
    // The application owns construction-time resources even when its start was never admitted.
    expect(order.filter(value => value.startsWith('stop:')).sort()).toEqual(['stop:application', 'stop:bootstrap', 'stop:transport']);
  });

  it('real App provider stop retry preserves live SQLite journal then closes it exactly once', async () => {
    const journal = new SqliteExecutionJournal(':memory:');
    const close = vi.spyOn(journal, 'close');
    let failProvider = true;
    const stopProvider = vi.fn(() => {
      expect(journal.readOutbox(1)).toEqual([]);
      if (failProvider) throw new Error('provider still owns work');
    });
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: vi.fn(), logger: { debug: vi.fn() } as never,
      skillProviders: [{ start: vi.fn(), stop: stopProvider, listSkills: () => [] }] as never,
      providerReadiness: () => [], extensionHostService: {} as never, skillCatalog: {} as never,
      skillPlanning: {} as never, skillAction: {} as never, perception: {} as never, ownedResources: [journal],
    });
    const { app } = controlledApp({ application: runtime });
    try {
      await app.start();
      await expect(app.stop()).rejects.toThrow('应用停止时存在资源释放失败');
      expect(app.state).toBe(AppLifecycleState.ERROR);
      expect(close).not.toHaveBeenCalled();
      expect(journal.readOutbox(1)).toEqual([]);
      failProvider = false;
      await app.stop();
      await app.stop();
      expect(app.state).toBe(AppLifecycleState.STOPPED);
      expect(stopProvider).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (close.mock.calls.length === 0) journal.close();
    }
  });

  it('transport failure retains unstarted construction owner across failed cleanup until retry succeeds', async () => {
    const journal = new SqliteExecutionJournal(':memory:');
    const close = vi.spyOn(journal, 'close');
    let failProvider = true;
    const providerStart = vi.fn();
    const providerStop = vi.fn(() => {
      expect(journal.readOutbox(1)).toEqual([]);
      if (failProvider) throw new Error('partial cleanup failed');
    });
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: vi.fn(), logger: { debug: vi.fn() } as never,
      skillProviders: [{ start: providerStart, stop: providerStop, listSkills: () => [] }] as never,
      providerReadiness: () => [], extensionHostService: {} as never, skillCatalog: {} as never,
      skillPlanning: {} as never, skillAction: {} as never, perception: {} as never, ownedResources: [journal],
    });
    const { app, order } = controlledApp({ application: runtime, transportError: true });
    try {
      await expect(app.start()).rejects.toThrow('应用启动失败');
      expect(app.state).toBe(AppLifecycleState.ERROR);
      expect(providerStart).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(order).not.toContain('AppStoppedEvent');
      expect(order).not.toContain('eventbus-close');
      expect(order).not.toContain('observability-close');
      failProvider = false;
      await app.stop();
      expect(app.state).toBe(AppLifecycleState.STOPPED);
      expect(close).toHaveBeenCalledOnce();
      expect(providerStop).toHaveBeenCalledTimes(2);
      expect(order.slice(-3)).toEqual(['AppStoppedEvent', 'eventbus-close', 'observability-close']);
      await expect(app.start()).rejects.toThrow('应用已关闭');
    } finally { if (close.mock.calls.length === 0) journal.close(); }
  });

  it('closed App rejects reuse of its shutdown event bus and cannot reopen ingress', async () => {
    const { app, openIngress, order } = controlledApp();
    await app.start();
    await app.stop();
    const starts = order.filter(value => value.startsWith('start:')).length;
    await expect(app.start()).rejects.toThrow('应用已关闭');
    expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(openIngress).toHaveBeenCalledOnce();
    expect(order.filter(value => value.startsWith('start:'))).toHaveLength(starts);
  });

  it.each([false, true])('concurrent start shares actual startup outcome (transport failure=%s)', async (transportError) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { app, order } = controlledApp({ startGate: gate, transportError });
    const starting = app.start();
    let completed = false;
    void starting.then(() => { completed = true; }, () => { completed = true; });
    const outcome = transportError ? expect(starting).rejects.toThrow('应用启动失败') : starting;
    expect(app.start()).toBe(starting);
    for (let tick = 0; tick < 50 && !order.includes('start:transport'); tick += 1) await Promise.resolve();
    expect(order).toContain('start:transport');
    expect(completed).toBe(false);
    expect(app.state).toBe(AppLifecycleState.INITIALIZING);
    release(); await outcome;
    expect(completed).toBe(true);
    expect(app.state).toBe(transportError ? AppLifecycleState.STOPPED : AppLifecycleState.RUNNING);
    await app.stop();
  });

  it('AppStarting observer awaiting its own startup fails explicitly and cleanup still closes resources', async () => {
    const { app, order } = controlledApp({
      onPublish: async type => { if (type === 'AppStartingEvent') await app.start(); },
    });
    await expect(app.start()).rejects.toThrow('自等待');
    expect(app.state).toBe(AppLifecycleState.STOPPED);
    expect(order.filter(value => value.startsWith('start:'))).toEqual([]);
    expect(order.slice(-2)).toEqual(['eventbus-close', 'observability-close']);
  });

  it.each(['AppStoppingEvent', 'ModuleStoppedEvent', 'close-ingress'])(
    'observer awaiting its own App.stop (%s) fails without skipping other resource release', async (callback) => {
      const { app, order } = controlledApp({
        onPublish: async type => { if (type === callback) await app.stop(); },
        onCloseIngress: async () => { if (callback === 'close-ingress') await app.stop(); },
      });
      await app.start();
      await expect(app.stop()).rejects.toThrow('应用停止时存在资源释放失败');
      expect(order.filter(value => value.startsWith('stop:'))).toHaveLength(6);
      expect(order.slice(-2)).toEqual(['eventbus-close', 'observability-close']);
      expect(app.state).toBe(AppLifecycleState.ERROR);
    },
  );

  it('stop immediately after start closes admission before any module can start', async () => {
    const { app, order, openIngress } = controlledApp();
    const starting = app.start();
    const outcome = expect(starting).rejects.toThrow('应用启动失败');
    const stopping = app.stop();
    await outcome; await stopping;
    expect(order.filter(value => value.startsWith('start:'))).toEqual([]);
    expect(openIngress).not.toHaveBeenCalled();
    expect(app.state).toBe(AppLifecycleState.STOPPED);
  });

  it('resource close retry skips successfully released resources and already drained execution', async () => {
    let failResource = true;
    const released = vi.fn();
    const retry = vi.fn(() => { if (failResource) throw new Error('resource failed'); });
    const drainExecution = vi.fn();
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler: vi.fn(), logger: { debug: vi.fn() } as never, skillProviders: [],
      providerReadiness: () => [], extensionHostService: {} as never, skillCatalog: {} as never,
      skillPlanning: {} as never, skillAction: {} as never, perception: {} as never,
      ownedResources: [{ close: retry }, { close: released }], drainExecution,
    });
    await expect(runtime.stop({} as never)).rejects.toThrow('资源释放失败');
    failResource = false;
    await runtime.stop({} as never);
    expect(drainExecution).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledTimes(2);
  });
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
      { replaceModuleSnapshots: vi.fn(), clear: vi.fn() } as never, new SystemClock(),
      { name: 'bootstrap', start: vi.fn(), stop: vi.fn(), config: { system: { lifecycle: { start_timeout_ms: 30000, stop_timeout_ms: 30000 } } } } as never,
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
  it('provider stop failure preserves dependencies and retry closes each acquired resource once', async () => {
    const close = vi.fn();
    const setCognitionActionHandler = vi.fn();
    let failProvider = true;
    const stopProvider = vi.fn(() => { if (failProvider) throw new Error('provider stop failed'); });
    const stoppedProvider = vi.fn();
    const runtime = new ApplicationRuntime({
      setCognitionActionHandler,
      logger: { debug: vi.fn() } as never,
      skillProviders: [{
        start: vi.fn(),
        stop: stopProvider,
        listSkills: () => [],
      }, { stop: stoppedProvider, listSkills: () => [] }] as never,
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
    expect(close).not.toHaveBeenCalled();
    expect(setCognitionActionHandler).toHaveBeenLastCalledWith(null);
    failProvider = false;
    await runtime.stop({} as never);
    await runtime.stop({} as never);
    expect(close).toHaveBeenCalledOnce();
    expect(stopProvider).toHaveBeenCalledTimes(2);
    expect(stoppedProvider).toHaveBeenCalledOnce();
  });
});
