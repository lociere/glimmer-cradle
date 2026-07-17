import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SESSION_COOKIE = 'glimmer_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 64;
const LOGIN_WINDOW_MS = 60_000;
const MAX_LOGIN_FAILURES = 8;

interface LoginAttempt {
  failures: number;
  windowStartedAt: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, number>();
  private readonly loginAttempts = new Map<string, LoginAttempt>();

  public constructor(private readonly accessToken: string) {}

  public authenticate(request: IncomingMessage): boolean {
    if (!this.accessToken) return true;
    if (this.authenticateBearer(request.headers.authorization)) return true;
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!sessionId) return false;
    const expiresAt = this.sessions.get(sessionId);
    if (!expiresAt || expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  public login(token: string, clientId: string): { sessionId: string; expiresAt: number } | null {
    if (this.isRateLimited(clientId)) return null;
    if (!secureEqual(token, this.accessToken)) {
      this.recordFailure(clientId);
      return null;
    }
    this.loginAttempts.delete(clientId);
    this.prune();
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sessions.delete(oldest);
    }
    const sessionId = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sessions.set(sessionId, expiresAt);
    return { sessionId, expiresAt };
  }

  public logout(request: IncomingMessage): void {
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (sessionId) this.sessions.delete(sessionId);
  }

  public sessionCookie(sessionId: string, request: IncomingMessage): string {
    const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
  }

  public clearCookie(request: IncomingMessage): string {
    const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  public isRateLimited(clientId: string): boolean {
    const attempt = this.loginAttempts.get(clientId);
    if (!attempt) return false;
    if (Date.now() - attempt.windowStartedAt >= LOGIN_WINDOW_MS) {
      this.loginAttempts.delete(clientId);
      return false;
    }
    return attempt.failures >= MAX_LOGIN_FAILURES;
  }

  private authenticateBearer(authorization: string | undefined): boolean {
    if (!authorization?.startsWith('Bearer ')) return false;
    return secureEqual(authorization.slice('Bearer '.length), this.accessToken);
  }

  private recordFailure(clientId: string): void {
    const current = this.loginAttempts.get(clientId);
    if (!current || Date.now() - current.windowStartedAt >= LOGIN_WINDOW_MS) {
      this.loginAttempts.set(clientId, { failures: 1, windowStartedAt: Date.now() });
      return;
    }
    current.failures += 1;
  }

  private prune(): void {
    const now = Date.now();
    for (const [sessionId, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(sessionId);
    }
  }
}

export function requestClientId(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

export function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(raw.split(';').flatMap((item) => {
    const index = item.indexOf('=');
    if (index <= 0) return [];
    return [[item.slice(0, index).trim(), item.slice(index + 1).trim()]];
  }));
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}
