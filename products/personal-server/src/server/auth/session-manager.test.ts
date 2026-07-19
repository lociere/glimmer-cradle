import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import type { AccessTokenPrincipal } from './access-token-store';
import { isSameOrigin, SessionManager } from './session-manager';

function request(headers: Record<string, string> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

const adminPrincipal: AccessTokenPrincipal = {
  token_id: 'token-admin',
  scopes: ['surface:read', 'surface:write', 'tokens:write', 'operations:write'],
  source: 'managed',
};

function createManager(token = 'server-secret'): SessionManager {
  return new SessionManager({
    authenticate: async (value: string) => value === token ? adminPrincipal : null,
    getSnapshot: async () => ({ mode: token ? 'managed' as const : 'open_local' as const }),
  });
}

test('exchanges the deployment token for an HttpOnly session cookie', async () => {
  const manager = createManager();
  const login = await manager.login('server-secret', '127.0.0.1');
  assert.ok(login);

  const cookie = manager.sessionCookie(login.sessionId, request({ 'x-forwarded-proto': 'https' }));
  assert.match(cookie, /^glimmer_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(cookie.includes('server-secret'), false);

  const sessionRequest = request({ cookie: cookie.split(';')[0] });
  assert.equal(await manager.authenticate(sessionRequest), true);
  manager.logout(sessionRequest);
  assert.equal(await manager.authenticate(sessionRequest), false);
});

test('accepts bearer automation without exposing query-token auth', async () => {
  const manager = createManager();
  assert.equal(await manager.authenticate(request({ authorization: 'Bearer server-secret' })), true);
  assert.equal(await manager.authenticate(request({ authorization: 'Bearer wrong' })), false);
});

test('rejects a browser websocket from another origin', () => {
  assert.equal(isSameOrigin(request({ host: 'cradle.example.com', origin: 'https://cradle.example.com' })), true);
  assert.equal(isSameOrigin(request({ host: 'cradle.example.com', origin: 'https://attacker.example' })), false);
});
