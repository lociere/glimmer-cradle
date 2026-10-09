import type { RuntimeModule, RuntimeModuleStartDetails } from '../src/lifecycle/runtime-module';
const assert = require('node:assert/strict');
const test = require('node:test');
const { LifecycleCoordinator } = require('../dist/lifecycle/supervisor.js') as typeof import('../src/lifecycle/supervisor');

const context = { trace_id: 'trace-lifecycle' };

function clock(...values: number[]) {
  let index = 0;
  return { monotonicNowMs: () => values[index++] ?? values.at(-1) ?? 0 };
}

function runtime(name: string, events: string[], options: {
  startGate?: Promise<void>; startError?: Error; details?: RuntimeModuleStartDetails;
} = {}): RuntimeModule {
  return {
    name,
    async start() {
      events.push(`start:${name}`);
      if (options.startGate) await options.startGate;
      if (options.startError) throw options.startError;
      return options.details;
    },
    async stop() {
      events.push(`stop:${name}`);
    },
  };
}

test('records serial startup and stops modules in reverse order', async () => {
  const events: string[] = [];
  const observed: string[] = [];
  const coordinator = new LifecycleCoordinator(clock(10, 15, 20, 29), {
    moduleStarted: (record) => { observed.push(record.moduleName); },
    moduleStopped: (module) => { observed.push(`stopped:${module.name}`); },
  });
  await coordinator.startPhase({
    name: 'foundation',
    modules: [runtime('first', events), runtime('second', events, { details: { ready: true } })],
  }, context);

  assert.deepEqual(events, ['start:first', 'start:second']);
  assert.deepEqual(observed, ['first', 'second']);
  assert.deepEqual(coordinator.startupReport, [
    { phase: 'foundation', moduleName: 'first', startupTimeMs: 5 },
    { phase: 'foundation', moduleName: 'second', startupTimeMs: 9, details: { ready: true } },
  ]);

  await coordinator.stopStarted(context);
  assert.deepEqual(events, ['start:first', 'start:second', 'stop:second', 'stop:first']);
  assert.deepEqual(observed, ['first', 'second', 'stopped:second', 'stopped:first']);
  assert.deepEqual(coordinator.started, []);
});

test('waits for every parallel start before reporting a phase failure', async () => {
  const events: string[] = [];
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const coordinator = new LifecycleCoordinator(clock(0, 0, 1, 2));
  const start = coordinator.startPhase({
    name: 'parallel',
    mode: 'parallel',
    modules: [
      runtime('failed', events, { startError: new Error('failed') }),
      runtime('delayed', events, { startGate: delayed }),
    ],
  }, context);

  await new Promise((resolve) => setImmediate(resolve));
  release();
  await assert.rejects(start, /failed/);
  assert.deepEqual(coordinator.started.map((module) => module.name), ['delayed']);
  await coordinator.stopStarted(context);
  assert.equal(events.filter(event => event === 'stop:failed').length, 1);
  assert.deepEqual(events.slice(-2), ['stop:delayed', 'stop:failed']);
});

test('stop/observer failures release other modules and retain only failed resource owners for retry', async () => {
  const events: string[] = [];
  let failStop = true;
  const first = runtime('first', events);
  const failed = { ...runtime('failed', events), stop() {
    events.push('stop:failed');
    if (failStop) throw new Error('resource release failed');
  } };
  const last = runtime('last', events);
  const coordinator = new LifecycleCoordinator(clock(0), {
    moduleStopped(module) { events.push(`observe:${module.name}`); if (module === last) throw new Error('observer failed'); },
  });
  await coordinator.startPhase({ name: 'resources', modules: [first, failed, last] }, context);
  await assert.rejects(coordinator.stopStarted(context), (error: AggregateError) => {
    assert.deepEqual(error.errors.map(error => error.message), ['observer failed', 'resource release failed']);
    return true;
  });
  assert.deepEqual(events.slice(3), ['stop:last', 'observe:last', 'stop:failed', 'stop:first', 'observe:first']);
  assert.deepEqual(coordinator.owned, [failed]);
  assert.deepEqual(coordinator.started, [failed]);
  assert.deepEqual(coordinator.startupReport.map(record => record.moduleName), ['failed']);
  failStop = false;
  await coordinator.stopStarted(context);
  assert.deepEqual(coordinator.owned, []);
  assert.deepEqual(coordinator.startupReport, []);
  assert.equal(events.filter(event => event === 'stop:last').length, 1);
  await assert.rejects(coordinator.startPhase({ name: 'late', modules: [first] }, context), /已关闭/);
});

test('closing fences new work, joins concurrent stops and drains accepted startup callbacks before release', async () => {
  const events: string[] = [];
  let releaseStart!: () => void;
  const gate = new Promise<void>(resolve => { releaseStart = resolve; });
  const coordinator = new LifecycleCoordinator(clock(0), { moduleStarted() { events.push('callback'); } });
  const starting = coordinator.startPhase({ name: 'serial', modules: [
    runtime('pending', events, { startGate: gate }), runtime('unstarted', events),
  ] }, context);
  const startOutcome = assert.rejects(starting, /已关闭/);
  await new Promise<void>(resolve => setImmediate(resolve));
  const stopping = coordinator.stopStarted(context);
  assert.equal(coordinator.stopStarted(context), stopping);
  await assert.rejects(coordinator.startPhase({ name: 'new', modules: [runtime('new', events)] }, context), /已关闭/);
  assert.deepEqual(events, ['start:pending']);
  releaseStart();
  await startOutcome;
  await stopping;
  assert.deepEqual(events, ['start:pending', 'callback', 'stop:pending']);
  assert.deepEqual(coordinator.owned, []);
  await coordinator.stopStarted(context);
  assert.equal(events.filter(event => event === 'stop:pending').length, 1);
});

test('failed start and failed moduleStarted observer both keep their acquired resources owned until stop', async () => {
  for (const failure of ['start', 'observer']) {
    const events: string[] = [];
    const coordinator = new LifecycleCoordinator(clock(30, 10), {
      moduleStarted() { if (failure === 'observer') throw new Error('observer failed'); },
    });
    const module = runtime('partial', events, { startError: failure === 'start' ? new Error('start failed') : undefined });
    await assert.rejects(coordinator.startPhase({ name: 'partial', modules: [module] }, context), /failed/);
    assert.deepEqual(coordinator.owned, [module]);
    if (failure === 'observer') assert.equal(coordinator.startupReport[0].startupTimeMs, 0);
    await coordinator.stopStarted(context);
    assert.deepEqual(events, ['start:partial', 'stop:partial']);
    assert.deepEqual(coordinator.owned, []);
  }
});

test('a phase observer delayed across closing cannot acquire a module after drain', async () => {
  const events: string[] = [];
  let releaseObserver!: () => void;
  const gate = new Promise<void>(resolve => { releaseObserver = resolve; });
  const coordinator = new LifecycleCoordinator(clock(0), { phaseStarting: () => gate });
  const starting = coordinator.startPhase({ name: 'delayed', modules: [runtime('never-started', events)] }, context);
  const startOutcome = assert.rejects(starting, /已关闭/);
  const stopping = coordinator.stopStarted(context);
  releaseObserver();
  await startOutcome;
  await stopping;
  assert.deepEqual(events, []);
  assert.deepEqual(coordinator.owned, []);
});
