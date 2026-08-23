import assert from 'node:assert/strict';
import { App } from '../../dist/composition/kernel-application.js';
import { AppLifecycleState } from '../../dist/domain/lifecycle/lifecycle-state.enum.js';

const calls = [];
const config = {
  system: { ingress: {} },
  character: {},
};
const runtime = (name) => ({
  name,
  start: async () => { calls.push(`start:${name}`); },
  stop: async () => { calls.push(`stop:${name}`); },
});
const transport = {
  ...runtime('transport'),
  openIngress: () => calls.push('ingress:open'),
  closeIngress: () => calls.push('ingress:close'),
};
const bootstrap = {
  ...runtime('bootstrap'),
  get config() { return config; },
};
const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  critical: () => undefined,
};
const eventBus = {
  publish: async () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  shutdown: async () => calls.push('event-bus:shutdown'),
};
const observability = {
  logger: () => logger,
  createTraceContext: () => ({ trace_id: 'production-bootstrap-smoke' }),
  currentTraceId: () => undefined,
  withTrace: async (_traceId, operation) => operation(),
  span: async (_name, operation) => operation({ setAttribute: () => undefined, setStatus: () => undefined }),
  histogram: () => undefined,
  counter: () => undefined,
  start: () => undefined,
  stop: () => undefined,
  close: async () => calls.push('observability:close'),
};
const projection = {
  replaceModuleSnapshots: () => undefined,
  clear: () => calls.push('projection:clear'),
};
const app = new App(
  logger,
  observability,
  eventBus,
  projection,
  bootstrap,
  () => ({
    transport,
    application: runtime('application'),
    presentation: [runtime('presentation')],
    coreReadiness: [runtime('cognition')],
    organism: runtime('organism'),
    recovery: runtime('recovery'),
  }),
);

await app.start();
assert.equal(app.state, AppLifecycleState.RUNNING);
assert.deepEqual(calls.slice(0, 7), [
  'start:bootstrap',
  'start:transport',
  'start:application',
  'start:presentation',
  'start:cognition',
  'ingress:open',
  'start:organism',
]);
await app.stop(0);
assert.equal(app.state, AppLifecycleState.STOPPED);
assert.ok(calls.includes('ingress:close'));
assert.ok(calls.indexOf('stop:recovery') < calls.indexOf('stop:bootstrap'));
assert.ok(calls.includes('event-bus:shutdown'));
assert.ok(calls.includes('observability:close'));

process.stdout.write('production bootstrap smoke passed\n');
