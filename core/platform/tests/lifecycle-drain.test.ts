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

test('startup observer awaiting the same coordinator stop is rejected instead of blocking drain', async () => {
  const events: string[] = [];
  const coordinator = new LifecycleCoordinator(clock(0), {
    moduleStarted: async () => { await coordinator.stopStarted(context); },
  });
  await assert.rejects(coordinator.startPhase({ name: 'observed', modules: [runtime('owned', events)] }, context), /自等待/);
  await coordinator.stopStarted(context);
  assert.deepEqual(events, ['start:owned', 'stop:owned']);
  assert.deepEqual(coordinator.owned, []);
});

test('stopping observer awaiting its own stop reports failure after releasing every owner', async () => {
  const events: string[] = [];
  const coordinator = new LifecycleCoordinator(clock(0), {
    moduleStopped: async () => { await coordinator.stopStarted(context); },
  });
  await coordinator.startPhase({ name: 'observed', modules: [runtime('first', events), runtime('second', events)] }, context);
  await assert.rejects(coordinator.stopStarted(context), (error: AggregateError) => {
    assert.equal(error.errors.length, 2);
    assert.ok(error.errors.every(error => /自等待/.test(error.message)));
    return true;
  });
  assert.deepEqual(events.slice(-2), ['stop:second', 'stop:first']);
  assert.deepEqual(coordinator.owned, []);
});

test('a later async descendant of a settled callback may stop while unrelated concurrent callers join', async () => {
  const events: string[] = [];
  let releaseLater!: () => void;
  const gate = new Promise<void>(resolve => { releaseLater = resolve; });
  let laterStop!: Promise<void>;
  const coordinator = new LifecycleCoordinator(clock(0), {
    moduleStarted() {
      laterStop = gate.then(() => coordinator.stopStarted(context));
    },
  });
  await coordinator.startPhase({ name: 'started', modules: [runtime('owned', events)] }, context);
  releaseLater();
  await laterStop;
  assert.deepEqual(events, ['start:owned', 'stop:owned']);
});

test('a module may drain a different coordinator without being mistaken for self-wait', async () => {
  const events: string[] = [];
  const child = new LifecycleCoordinator(clock(0));
  const parent = new LifecycleCoordinator(clock(0));
  await child.startPhase({ name: 'child', modules: [runtime('child', events)] }, context);
  await parent.startPhase({ name: 'parent', modules: [{ ...runtime('parent', events),
    async stop() { events.push('stop:parent'); await child.stopStarted(context); },
  }] }, context);
  await parent.stopStarted(context);
  assert.deepEqual(events, ['start:child', 'start:parent', 'stop:parent', 'stop:child']);
  assert.deepEqual(parent.owned, []);
  assert.deepEqual(child.owned, []);
});

const { EventEmitter } = require('node:events');
const { Deadline, ManagedProcessSupervisor, waitWithCancellation } = require('../dist/index.js') as typeof import('../src/index');
const quietProcessLogger = { info() {}, warn() {}, error() {} };
function processFixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 4422, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
    killed: false, kill() { this.killed = true; return true; },
  }) as import('node:child_process').ChildProcess;
  let now = 0;
  const timers = new Set<{ at: number; task: () => void }>();
  const controlled = {
    monotonicNowMs: () => now,
    schedule(delay: number, task: () => void) {
      const timer = { at: now + delay, task }; timers.add(timer);
      return { cancel: () => { timers.delete(timer); } };
    },
    advance(delta: number) { now += delta; for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.task(); } },
  };
  const exit = () => { Object.assign(child, { exitCode: 0 }); child.emit('exit', 0, null); };
  return { child, controlled, timers, exit };
}

test('a shared monotonic deadline preserves one budget and distinguishes completed undefined from expiry', async () => {
  const fixture = processFixture();
  const deadline = new Deadline(fixture.controlled, 30);
  const first = deadline.waitFor(Promise.resolve(undefined));
  fixture.controlled.advance(15);
  assert.deepEqual(await first, { status: 'completed', value: undefined });
  assert.equal(fixture.timers.size, 0);
  let release!: () => void;
  const actual = new Promise<void>(resolve => { release = resolve; });
  let actuallyDrained = false;
  void actual.then(() => { actuallyDrained = true; });
  const second = deadline.waitFor(actual);
  fixture.controlled.advance(15);
  assert.deepEqual(await second, { status: 'expired' });
  assert.equal(actuallyDrained, false);
  assert.equal(fixture.timers.size, 0);
  release(); await actual;
  assert.equal(actuallyDrained, true);
  assert.deepEqual(await new Deadline(fixture.controlled, 30).waitFor(actual), { status: 'completed', value: undefined });
});

test('cancelling a wait removes its listener while the actual callback can still settle later', async () => {
  const cancellation = new AbortController();
  const getListeners = require('node:events').getEventListeners;
  let release!: () => void, settled = false;
  const actual = new Promise<void>(resolve => { release = resolve; }).then(() => { settled = true; });
  const wait = waitWithCancellation(actual, cancellation.signal);
  assert.equal(getListeners(cancellation.signal, 'abort').length, 1);
  cancellation.abort(new Error('caller cancelled'));
  await assert.rejects(wait, /caller cancelled/);
  assert.equal(settled, false);
  assert.equal(getListeners(cancellation.signal, 'abort').length, 0);
  // A pre-cancelled wait still observes the input rejection, avoiding an unhandled late failure.
  await assert.rejects(waitWithCancellation(Promise.reject(new Error('actual failed')), cancellation.signal), /caller cancelled/);
  release(); await actual;
  assert.equal(settled, true);
});

test('completed and failed waits release timers/listeners and deadline clock failures propagate', async () => {
  const fixture = processFixture(), cancellation = new AbortController();
  const getListeners = require('node:events').getEventListeners;
  assert.equal(await waitWithCancellation(Promise.resolve(42), cancellation.signal), 42);
  await assert.rejects(waitWithCancellation(Promise.reject(new Error('actual failed')), cancellation.signal), /actual failed/);
  assert.equal(getListeners(cancellation.signal, 'abort').length, 0);
  await assert.rejects(new Deadline(fixture.controlled, 30).waitFor(Promise.reject(new Error('actual failed'))), /actual failed/);
  assert.equal(fixture.timers.size, 0);
  let broken = false;
  const deadline = new Deadline({ ...fixture.controlled, monotonicNowMs() { if (broken) throw new Error('clock failed'); return 0; } }, 30);
  const waiting = deadline.waitFor(Promise.resolve(42));
  broken = true;
  await assert.rejects(waiting, /clock failed/);
  assert.equal(fixture.timers.size, 0);
});

test('deadline expiry rejects new waits without losing observation of an actual rejected operation', async () => {
  const fixture = processFixture();
  const deadline = new Deadline(fixture.controlled, 0);
  assert.deepEqual(await deadline.waitFor(Promise.reject(new Error('late failure'))), { status: 'expired' });
  assert.equal(fixture.timers.size, 0);
  assert.throws(() => new Deadline(fixture.controlled, -1), /预算无效/);
});

test('managed process timeout cancels its clock task and detaches the exit listener', async () => {
  const fixture = processFixture();
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled);
  const wait = supervisor.waitForManagedProcessExit(fixture.child, 25);
  fixture.controlled.advance(25);
  assert.equal(await wait, false);
  assert.equal(fixture.child.listenerCount('exit'), 0);
  assert.equal(fixture.timers.size, 0);
  const actualExit = supervisor.waitForManagedProcessExit(fixture.child, 25);
  fixture.exit();
  assert.equal(await actualExit, true);
  assert.equal(fixture.timers.size, 0);
});

test('accepted kill and child.killed cannot substitute for a root exit receipt', async () => {
  const fixture = processFixture();
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled, {
    platform: 'linux', signalProcessGroup() {},
  });
  const stop = supervisor.forceTerminateManagedProcessTree(fixture.child, 'hung-root', 25);
  const rejection = assert.rejects(stop, /未在回收期限内退出/);
  assert.equal(fixture.child.killed, true);
  fixture.controlled.advance(25);
  await rejection;
  assert.equal(supervisor.isProcessReleased(fixture.child), false);
  assert.equal(fixture.child.listenerCount('exit'), 0);
});

test('Windows refuses an unowned tree, retains it after root exit and forbids dead PID retry', async () => {
  const fixture = processFixture();
  let calls = 0;
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled, {
    platform: 'win32', signalProcessGroup() { calls += 1; },
  });
  await assert.rejects(supervisor.forceTerminateManagedProcessTree(fixture.child, 'unknown-tree', 25), /缺少所属 Native Job owner/);
  fixture.exit();
  assert.equal(supervisor.isProcessReleased(fixture.child), false);
  await assert.rejects(supervisor.forceTerminateManagedProcessTree(fixture.child, 'unknown-tree', 25), /禁止复用其 PID/);
  assert.equal(calls, 0);
});

test('throwing stop logger does not skip native termination or discard the exit receipt', async () => {
  const fixture = processFixture();
  let calls = 0;
  const supervisor = new ManagedProcessSupervisor({ ...quietProcessLogger, warn() { throw new Error('observer failure'); } }, fixture.controlled, {
    platform: 'linux', signalProcessGroup() { calls += 1; fixture.exit(); }, isProcessGroupAlive() { return false; },
  });
  await assert.rejects(supervisor.forceTerminateManagedProcessTree(fixture.child, 'observer', 25, true), /停止 observer 失败/);
  assert.equal(calls, 1);
  assert.equal(supervisor.isProcessReleased(fixture.child), true);
  assert.equal(fixture.timers.size, 0);
});

test('invalid native termination budget never signals the owned process', async () => {
  const fixture = processFixture();
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled);
  for (const budget of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
    await assert.rejects(supervisor.forceTerminateManagedProcessTree(fixture.child, 'invalid-budget', budget), /timeout 无效/);
  }
  assert.equal(fixture.child.killed, false);
});

test('native isolated Node root exits within the termination budget', async () => {
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger);
  const bridge = require('node:path').resolve(__dirname, '../../../build/components/native/composition-host/windows-x64/PlatformProcessTreeBridge.exe');
  const child = supervisor.spawnManagedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  }, bridge);
  child.stdout!.resume(); child.stderr!.resume();
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await supervisor.waitForManagedProcessReady(child, 5000);
  try {
    await supervisor.forceTerminateManagedProcessTree(child, 'isolated-test-root', 5000, process.platform !== 'win32');
    assert.equal(supervisor.isProcessReleased(child), true);
    assert.equal(child.exitCode != null || child.signalCode != null, true);
  } finally {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGKILL');
      assert.equal(await supervisor.waitForManagedProcessExit(child, 5000), true);
    }
  }
});

test('a tracked POSIX group keeps its owner when its leader exits before its descendant', async () => {
  const fixture = processFixture();
  let groupAlive = true;
  let kills = 0;
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled, {
    platform: 'linux', signalProcessGroup() { kills += 1; },
    isProcessGroupAlive() { return groupAlive; },
  });
  supervisor.observeManagedProcess(fixture.child, true);
  fixture.exit();
  assert.equal(supervisor.isProcessReleased(fixture.child), false);
  await assert.rejects(supervisor.forceTerminateManagedProcessTree(fixture.child, 'leader-first', 25, true), /禁止复用其 PID/);
  assert.equal(kills, 0);
  groupAlive = false;
  assert.equal(supervisor.isProcessReleased(fixture.child), true);
});

test('group signal acceptance and root exit wait for a separate empty-group receipt', async () => {
  const fixture = processFixture();
  let groupAlive = true;
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled, {
    platform: 'linux', signalProcessGroup() { fixture.exit(); },
    isProcessGroupAlive() { return groupAlive; },
  });
  const stopping = supervisor.forceTerminateManagedProcessTree(fixture.child, 'group-drain', 50, true);
  await Promise.resolve();
  assert.equal(supervisor.isProcessReleased(fixture.child), false);
  groupAlive = false;
  fixture.controlled.advance(25);
  await stopping;
  assert.equal(supervisor.isProcessReleased(fixture.child), true);
  assert.equal(fixture.timers.size, 0);
});

test('a real POSIX adapter spawn error without PID proves no target was created and permits recovery', async () => {
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, undefined, { platform: 'linux', signalProcessGroup() {} });
  const child = supervisor.spawnManagedProcess(require('node:path').resolve('glimmer-nonexistent-executable'), [], { stdio: 'ignore', detached: true }, undefined);
  const exit = supervisor.waitForManagedProcessExit(child, 1000);
  await assert.rejects(supervisor.waitForManagedProcessReady(child, 1000), /ENOENT|未创建/);
  assert.equal(child.pid, undefined);
  assert.equal(await exit, true);
  assert.equal(supervisor.isProcessReleased(child), true);
  assert.equal(supervisor.isManagedProcessRootRunning(child), false);
  await supervisor.stopManagedProcess(child, { label: 'never-created', ownsProcessGroup: true });
  const recovered = supervisor.spawnManagedProcess(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }, undefined);
  await supervisor.waitForManagedProcessReady(recovered, 1000);
  assert.equal(await supervisor.waitForManagedProcessExit(recovered, 1000), true);
  assert.equal(supervisor.isProcessReleased(recovered), true);
  assert.equal(recovered.listenerCount('error'), 1, 'only the supervisor admission observer remains');
});

test('a POSIX root observer failure cannot interrupt actual exit and empty-group confirmation', async () => {
  const fixture = processFixture();
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled, {
    platform: 'linux', signalProcessGroup() { fixture.exit(); }, isProcessGroupAlive() { return false; },
  });
  supervisor.onManagedProcessRootExit(fixture.child, () => { throw new Error('root notification failed'); });
  await assert.rejects(supervisor.forceTerminateManagedProcessTree(fixture.child, 'observer', 25, true), /observer 失败/);
  assert.equal(supervisor.isProcessReleased(fixture.child), true);
  assert.equal(fixture.child.listenerCount('exit'), 0);
  assert.equal(fixture.timers.size, 0);
});

test('a delayed empty POSIX group reports its captured root observer error after releasing ownership', async () => {
  const fixture = processFixture();
  let groupAlive = true;
  const supervisor = new ManagedProcessSupervisor(quietProcessLogger, fixture.controlled, {
    platform: 'linux', signalProcessGroup() {}, isProcessGroupAlive() { return groupAlive; },
  });
  supervisor.observeManagedProcess(fixture.child, true);
  supervisor.onManagedProcessRootExit(fixture.child, () => { throw new Error('notification failed'); });
  fixture.exit();
  const stop = supervisor.stopManagedProcess(fixture.child, { label: 'late-group', gracefulTimeoutMs: 50, ownsProcessGroup: true });
  const rejected = assert.rejects(stop, /observer 失败/);
  groupAlive = false;
  fixture.controlled.advance(25);
  await rejected;
  assert.equal(supervisor.isProcessReleased(fixture.child), true);
  assert.equal(fixture.timers.size, 0);
});
