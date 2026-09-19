import assert from 'node:assert/strict';
import test from 'node:test';

import { LifecycleCoordinator } from '../dist/lifecycle/index.js';

const context = { trace_id: 'trace-lifecycle' };

function clock(...values) {
  let index = 0;
  return { monotonicNowMs: () => values[index++] ?? values.at(-1) ?? 0 };
}

function runtime(name, events, options = {}) {
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
  const events = [];
  const observed = [];
  const coordinator = new LifecycleCoordinator(clock(10, 15, 20, 29), {
    moduleStarted: (record) => observed.push(record.moduleName),
    moduleStopped: (module) => observed.push(`stopped:${module.name}`),
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
  const events = [];
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
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
  assert.equal(events.at(-1), 'stop:delayed');
});
