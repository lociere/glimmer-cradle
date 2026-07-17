import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import { isSameOrigin, SessionManager } from './session-manager';

function request(headers: Record<string, string> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

test('exchanges the deployment token for an HttpOnly session cookie', () => {
  const manager = new SessionManager('server-secret');
  const login = manager.login('server-secret', '127.0.0.1');
  assert.ok(login);

  const cookie = manager.sessionCookie(login.sessionId, request({ 'x-forwarded-proto': 'https' }));
  assert.match(cookie, /^glimmer_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(cookie.includes('server-secret'), false);

  const sessionRequest = request({ cookie: cookie.split(';')[0] });
  assert.equal(manager.authenticate(sessionRequest), true);
  manager.logout(sessionRequest);
  assert.equal(manager.authenticate(sessionRequest), false);
});

test('accepts bearer automation without exposing query-token auth', () => {
  const manager = new SessionManager('server-secret');
  assert.equal(manager.authenticate(request({ authorization: 'Bearer server-secret' })), true);
  assert.equal(manager.authenticate(request({ authorization: 'Bearer wrong' })), false);
});

test('rejects a browser websocket from another origin', () => {
  assert.equal(isSameOrigin(request({ host: 'cradle.example.com', origin: 'https://cradle.example.com' })), true);
  assert.equal(isSameOrigin(request({ host: 'cradle.example.com', origin: 'https://attacker.example' })), false);
});
