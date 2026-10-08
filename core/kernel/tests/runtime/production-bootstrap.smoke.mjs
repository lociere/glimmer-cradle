import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

if (!process.argv.includes('--bootstrap-child')) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'kernel-production-bootstrap-'));
  const run = promisify(execFile);
  const launch = async () => {
    try {
      await run(process.execPath, [fileURLToPath(import.meta.url), '--bootstrap-child'], {
        env: { ...process.env, GLIMMER_CRADLE_DATA_ROOT: dataRoot },
        windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 60_000,
      });
    } catch (error) {
      process.stderr.write(error.stderr ?? String(error));
      throw error;
    }
  };
  try {
    await launch();
    const deliveryPath = path.join(dataRoot, 'state/conversation/delivery.db');
    const delivery = new Database(deliveryPath, { readonly: true });
    let firstEpoch;
    try {
      assert.equal(delivery.prepare("SELECT value FROM delivery_authority_meta WHERE key='schema_version'").get().value, '1');
      firstEpoch = delivery.prepare("SELECT value FROM delivery_authority_meta WHERE key='authority_epoch'").get().value;
      assert.ok(firstEpoch);
    } finally { delivery.close(); }
    await launch();
    const restartedDelivery = new Database(deliveryPath, { readonly: true });
    try {
      const currentEpoch = restartedDelivery.prepare("SELECT value FROM delivery_authority_meta WHERE key='authority_epoch'").get().value;
      assert.notEqual(currentEpoch, firstEpoch);
      assert.deepEqual(restartedDelivery.prepare('SELECT authority_epoch FROM delivery_retired_authorities').all(), [{ authority_epoch: firstEpoch }]);
      assert.equal(restartedDelivery.prepare('SELECT count(*) AS n FROM delivery_outputs').get().n, 0);
      assert.equal(restartedDelivery.prepare('SELECT count(*) AS n FROM delivery_receipts').get().n, 0);
      assert.equal(restartedDelivery.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('delivery_receipt_meta','delivery_receipt_facts')").get().n, 0);
    } finally { restartedDelivery.close(); }
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
  process.stdout.write('production composition bootstrap/restart smoke passed\n');
} else {
  const dataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
  assert.ok(dataRoot && path.isAbsolute(dataRoot));
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
  }
}
