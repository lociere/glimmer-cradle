import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalExtensionUploadStore } from './local-extension-upload-store';

test('binds uploaded packages to the creating session and clears consumed files', async () => {
  const uploadRoot = mkdtempSync(path.join(tmpdir(), 'local-extension-upload-'));
  let now = Date.now();
  const store = new LocalExtensionUploadStore(uploadRoot, {
    retentionMs: 60_000,
    now: () => now,
  });
  await store.initialize();

  const firstSession = { principalId: 'token-a', sessionBinding: 'session:a' };
  const secondSession = { principalId: 'token-a', sessionBinding: 'session:b' };
  const upload = await store.storeUpload('community.example.gcex', new Uint8Array([1, 2, 3]), firstSession);

  await assert.rejects(
    () => store.materializeUploadForPrepare(upload.upload_id, 'prepare-foreign', secondSession),
    /当前登录会话/,
  );

  const materialized = await store.materializeUploadForPrepare(upload.upload_id, 'prepare-own', firstSession);
  assert.equal(existsSync(materialized.path), true);
  await store.finalizePrepare('prepare-own', 'tx-1');
  assert.equal(existsSync(materialized.path), false);

  const expiring = await store.storeUpload('community.expiring.gcex', new Uint8Array([4]), firstSession);
  now += 61_000;
  await assert.rejects(
    () => store.materializeUploadForPrepare(expiring.upload_id, 'prepare-expired', firstSession),
    /不存在、已过期或已被清理/,
  );
});

test('discards session uploads on disconnect cleanup', async () => {
  const uploadRoot = mkdtempSync(path.join(tmpdir(), 'local-extension-upload-'));
  const store = new LocalExtensionUploadStore(uploadRoot, {
    retentionMs: 60_000,
  });
  await store.initialize();

  const session = { principalId: 'token-a', sessionBinding: 'session:a' };
  const upload = await store.storeUpload('community.disconnect.gcex', new Uint8Array([9]), session);
  const materialized = await store.materializeUploadForPrepare(upload.upload_id, 'prepare-disconnect', session);
  assert.equal(existsSync(materialized.path), true);

  await store.discardPrepare('prepare-disconnect');
  assert.equal(existsSync(materialized.path), false);

  const lingering = await store.storeUpload('community.lingering.gcex', new Uint8Array([7]), session);
  await store.disposeSessionUploads(session);
  await assert.rejects(
    () => store.materializeUploadForPrepare(lingering.upload_id, 'prepare-missing', session),
    /不存在、已过期或已被清理/,
  );
});
