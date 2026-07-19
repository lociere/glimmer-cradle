import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AccessTokenStore } from './access-token-store';

test('creates, rotates and revokes managed access tokens without exposing stored secrets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'access-token-store-'));
  const store = new AccessTokenStore({
    configRoot: path.join(root, 'configs'),
    loopbackOnly: false,
  });

  const created = await store.createToken('Ops laptop');
  assert.equal(created.status, 'success');
  assert.ok(created.issued_token);
  assert.ok(created.issued_token_id);
  assert.equal(created.snapshot.mode, 'managed');
  assert.equal(created.snapshot.tokens.some((token) => token.label === 'Ops laptop'), true);
  assert.equal(created.snapshot.tokens.some((token) => 'issued_token' in token), false);

  const authenticated = await store.authenticate(created.issued_token || '');
  assert.ok(authenticated);
  assert.equal(authenticated?.source, 'managed');

  const rotated = await store.rotateToken(created.issued_token_id || '');
  assert.equal(rotated.status, 'success');
  assert.ok(rotated.issued_token);
  assert.notEqual(rotated.issued_token, created.issued_token);
  assert.equal(await store.authenticate(created.issued_token || ''), null);
  assert.ok(await store.authenticate(rotated.issued_token || ''));

  const revoked = await store.revokeToken(created.issued_token_id || '');
  assert.equal(revoked.status, 'error');
  assert.match(revoked.message, /至少保留一个可登录的访问令牌/);

  const second = await store.createToken('Emergency');
  assert.equal(second.status, 'success');
  const revokedFirst = await store.revokeToken(created.issued_token_id || '');
  assert.equal(revokedFirst.status, 'success');
  assert.equal(await store.authenticate(rotated.issued_token || ''), null);
});

test('reports loopback open-local mode when no token is configured', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'access-token-store-open-local-'));
  const store = new AccessTokenStore({
    configRoot: path.join(root, 'configs'),
    loopbackOnly: true,
  });
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.mode, 'open_local');
  const principal = await store.authenticate('');
  assert.ok(principal);
  assert.equal(principal?.source, 'open_local');
});
