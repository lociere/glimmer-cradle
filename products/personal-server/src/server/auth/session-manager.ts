import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AccessTokenPrincipal, PersonalServerAccessScope } from './access-token-store';

const SESSION_COOKIE = 'glimmer_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 64;
const LOGIN_WINDOW_MS = 60_000;
const MAX_LOGIN_FAILURES = 8;

interface SessionRecord {
  readonly expiresAt: number;
  readonly principal: AccessTokenPrincipal;
}

interface LoginAttempt {
  failures: number;
  windowStartedAt: number;
}

export interface AuthorizedSession {
  readonly principal: AccessTokenPrincipal;
  readonly sessionBinding: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly loginAttempts = new Map<string, LoginAttempt>();

  public constructor(
    private readonly accessTokens: {
      authenticate(token: string): Promise<AccessTokenPrincipal | null>;
      getSnapshot(): Promise<{ mode: 'managed' | 'legacy_env' | 'open_local' }>;
    },
  ) {}

  public async authenticate(
    request: IncomingMessage,
    requiredScope: PersonalServerAccessScope = 'surface:read',
  ): Promise<boolean> {
    return Boolean(await this.authorize(request, requiredScope));
  }

  public async authorize(
    request: IncomingMessage,
    requiredScope: PersonalServerAccessScope = 'surface:read',
  ): Promise<AuthorizedSession | null> {
    const bearerPrincipal = await this.authenticateBearer(request.headers.authorization, requiredScope);
    if (bearerPrincipal) {
      return {
        principal: bearerPrincipal,
        sessionBinding: `bearer:${bearerPrincipal.token_id}`,
      };
    }
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (!sessionId) {
      const snapshot = await this.accessTokens.getSnapshot();
      if (snapshot.mode !== 'open_local') return null;
      return {
        principal: {
          token_id: 'open-local',
          scopes: ['surface:read', 'surface:write', 'tokens:write', 'operations:write'],
          source: 'open_local',
        },
        sessionBinding: 'open_local',
      };
    }
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    if (!session.principal.scopes.includes(requiredScope)) {
      return null;
    }
    return {
      principal: session.principal,
      sessionBinding: `session:${sessionId}`,
    };
  }

  public async login(token: string, clientId: string): Promise<{
    sessionId: string;
    expiresAt: number;
    principal: AccessTokenPrincipal;
  } | null> {
    if (this.isRateLimited(clientId)) return null;
    const principal = await this.accessTokens.authenticate(token);
    if (!principal) {
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
    this.sessions.set(sessionId, { expiresAt, principal });
    return { sessionId, expiresAt, principal };
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

  private async authenticateBearer(
    authorization: string | undefined,
    requiredScope: PersonalServerAccessScope,
  ): Promise<AccessTokenPrincipal | null> {
    if (!authorization?.startsWith('Bearer ')) return null;
    const principal = await this.accessTokens.authenticate(authorization.slice('Bearer '.length));
    return principal?.scopes.includes(requiredScope) ? principal : null;
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
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(sessionId);
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
