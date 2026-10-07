import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const previousDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-production-bootstrap-'));
process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;

let app;
try {
  const [{ createKernelApplication }, { loadProductComposition }, { AppLifecycleState }] = await Promise.all([
    import('../../dist/composition/kernel-application.js'),
    import('../../dist/composition/product-composition.js'),
    import('../../dist/domain/lifecycle/lifecycle-state.enum.js'),
  ]);
  const desktop = loadProductComposition();
  const smokeProduct = {
    ...desktop,
    display_name: `${desktop.display_name} Production Bootstrap Smoke`,
    features: {
      control_surface_gateway: false,
      local_device_actions: false,
      avatar: false,
      audio: { tts: false, asr: false },
      extensions: false,
    },
  };

  app = createKernelApplication(smokeProduct);
  await app.start();
  assert.equal(app.state, AppLifecycleState.RUNNING);
  const execution = new Database(path.join(dataRoot, 'state/capabilities/execution.sqlite'), { readonly: true });
  try {
    assert.equal(execution.pragma('application_id', { simple: true }), 0x47434558);
    assert.equal(execution.pragma('user_version', { simple: true }), 2);
    assert.equal(execution.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('executions','execution_outbox')").get().n, 2);
  } finally { execution.close(); }
  await app.stop(0);
  assert.equal(app.state, AppLifecycleState.STOPPED);
} finally {
  if (app) await app.stop(1);
  if (previousDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = previousDataRoot;
  await rm(dataRoot, { recursive: true, force: true });
}

process.stdout.write('production composition bootstrap smoke passed\n');
