import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';

export type PersonalServerAccessScope = 'surface:read' | 'surface:write' | 'tokens:write' | 'operations:write';

export interface AccessTokenPrincipal {
  readonly token_id: string;
  readonly scopes: ReadonlyArray<PersonalServerAccessScope>;
  readonly source: 'managed' | 'legacy_env' | 'open_local';
}

export interface AccessTokenSnapshotItem {
  readonly token_id: string;
  readonly label: string;
  readonly scopes: ReadonlyArray<PersonalServerAccessScope>;
  readonly source: 'managed' | 'legacy_env' | 'open_local';
  readonly managed: boolean;
  readonly rotatable: boolean;
  readonly revocable: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at?: string;
  readonly disabled_reason?: string;
}

export interface AccessTokenSnapshot {
  readonly mode: 'managed' | 'legacy_env' | 'open_local';
  readonly degraded: boolean;
  readonly message: string;
  readonly tokens: ReadonlyArray<AccessTokenSnapshotItem>;
}

export interface AccessTokenMutationResult {
  readonly status: 'success' | 'error';
  readonly message: string;
  readonly snapshot: AccessTokenSnapshot;
  readonly issued_token?: string;
  readonly issued_token_id?: string;
}

interface StoredTokenRecord {
  readonly token_id: string;
  readonly label: string;
  readonly scopes: ReadonlyArray<PersonalServerAccessScope>;
  readonly salt: string;
  readonly hash: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at?: string;
}

interface StoredTokenDocument {
  readonly schema_version: 1;
  readonly tokens: StoredTokenRecord[];
}

const TOKEN_FILE_NAME = path.join('secrets', 'personal-server-tokens.yaml');
const DEFAULT_SCOPES: ReadonlyArray<PersonalServerAccessScope> = [
  'surface:read',
  'surface:write',
  'tokens:write',
  'operations:write',
];
const LAST_USED_WRITE_THROTTLE_MS = 30_000;

export class AccessTokenStore {
  private readonly tokenFilePath: string;
  private readonly legacyToken: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly options: {
      readonly configRoot: string;
      readonly loopbackOnly: boolean;
      readonly legacyToken?: string;
      readonly now?: () => Date;
    },
  ) {
    this.tokenFilePath = path.join(options.configRoot, TOKEN_FILE_NAME);
    this.legacyToken = options.legacyToken?.trim() || '';
  }

  public async authenticate(rawToken: string): Promise<AccessTokenPrincipal | null> {
    return this.runExclusive(async () => {
      const supplied = rawToken.trim();
      const document = await this.readDocument();
      for (const token of document.tokens) {
        if (verifyToken(supplied, token.salt, token.hash)) {
          await this.markLastUsed(token.token_id, document);
          return {
            token_id: token.token_id,
            scopes: token.scopes,
            source: 'managed',
          };
        }
      }

      if (this.legacyToken && secureEqual(supplied, this.legacyToken)) {
        return {
          token_id: 'legacy-env',
          scopes: DEFAULT_SCOPES,
          source: 'legacy_env',
        };
      }

      if (!this.legacyToken && document.tokens.length === 0 && this.options.loopbackOnly) {
        return {
          token_id: 'open-local',
          scopes: DEFAULT_SCOPES,
          source: 'open_local',
        };
      }

      return null;
    });
  }

  public async getSnapshot(): Promise<AccessTokenSnapshot> {
    const document = await this.readDocument();
    const items: AccessTokenSnapshotItem[] = document.tokens.map((token) => ({
      token_id: token.token_id,
      label: token.label,
      scopes: token.scopes,
      source: 'managed' as const,
      managed: true,
      rotatable: true,
      revocable: document.tokens.length > 1 || Boolean(this.legacyToken),
      created_at: token.created_at,
      updated_at: token.updated_at,
      last_used_at: token.last_used_at,
    }));

    if (this.legacyToken) {
      items.unshift({
        token_id: 'legacy-env',
        label: '环境变量访问令牌',
        scopes: DEFAULT_SCOPES,
        source: 'legacy_env',
        managed: false,
        rotatable: false,
        revocable: false,
        created_at: 'unknown',
        updated_at: 'unknown',
        disabled_reason: '该令牌来自 GLIMMER_CRADLE_SERVER_TOKEN 环境变量，只能通过部署环境修改。',
      });
    } else if (document.tokens.length === 0 && this.options.loopbackOnly) {
      items.unshift({
        token_id: 'open-local',
        label: '本地回环免令牌访问',
        scopes: DEFAULT_SCOPES,
        source: 'open_local',
        managed: false,
        rotatable: false,
        revocable: false,
        created_at: this.nowIso(),
        updated_at: this.nowIso(),
        disabled_reason: '当前仅绑定回环地址且未配置访问令牌。建议创建正式令牌后再对外提供入口。',
      });
    }

    if (document.tokens.length > 0) {
      return {
        mode: 'managed',
        degraded: false,
        message: '当前使用受管访问令牌集。',
        tokens: items,
      };
    }
    if (this.legacyToken) {
      return {
        mode: 'legacy_env',
        degraded: true,
        message: '当前仍使用环境变量访问令牌；可在控制面创建新的受管令牌，但环境变量本身不可直接轮换。',
        tokens: items,
      };
    }
    return {
      mode: 'open_local',
      degraded: true,
      message: '当前处于回环地址免令牌模式；管理页面可正常使用，但建议先创建正式访问令牌。',
      tokens: items,
    };
  }

  public async createToken(label: string): Promise<AccessTokenMutationResult> {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      return {
        status: 'error',
        message: '访问令牌标签不能为空。',
        snapshot: await this.getSnapshot(),
      };
    }
    return this.runExclusive(async () => {
      const document = await this.readDocument();
      const issuedToken = `gcps_${randomBytes(24).toString('base64url')}`;
      const salt = randomBytes(16).toString('hex');
      const tokenId = `token-${randomBytes(8).toString('hex')}`;
      const now = this.nowIso();
      const next: StoredTokenRecord = {
        token_id: tokenId,
        label: normalizedLabel,
        scopes: DEFAULT_SCOPES,
        salt,
        hash: hashToken(issuedToken, salt),
        created_at: now,
        updated_at: now,
      };
      await this.writeDocument({
        schema_version: 1,
        tokens: [...document.tokens, next].sort((left, right) => left.created_at.localeCompare(right.created_at)),
      });
      return {
        status: 'success',
        message: '已创建新的访问令牌。该明文只会显示一次。',
        snapshot: await this.getSnapshot(),
        issued_token: issuedToken,
        issued_token_id: tokenId,
      };
    });
  }

  public async rotateToken(tokenId: string): Promise<AccessTokenMutationResult> {
    return this.runExclusive(async () => {
      const document = await this.readDocument();
      const target = document.tokens.find((token) => token.token_id === tokenId);
      if (!target) {
        return {
          status: 'error',
          message: '要轮换的访问令牌不存在。',
          snapshot: await this.getSnapshot(),
        };
      }
      const issuedToken = `gcps_${randomBytes(24).toString('base64url')}`;
      const salt = randomBytes(16).toString('hex');
      const now = this.nowIso();
      const updated = document.tokens.map((token) => token.token_id === tokenId
        ? {
          ...token,
          salt,
          hash: hashToken(issuedToken, salt),
          updated_at: now,
        }
        : token);
      await this.writeDocument({ schema_version: 1, tokens: updated });
      return {
        status: 'success',
        message: '访问令牌已轮换。旧明文已立即失效。',
        snapshot: await this.getSnapshot(),
        issued_token: issuedToken,
        issued_token_id: tokenId,
      };
    });
  }

  public async revokeToken(tokenId: string): Promise<AccessTokenMutationResult> {
    return this.runExclusive(async () => {
      const document = await this.readDocument();
      if (document.tokens.length <= 1 && !this.legacyToken) {
        return {
          status: 'error',
          message: '至少保留一个可登录的访问令牌；请先创建新令牌后再撤销最后一个受管令牌。',
          snapshot: await this.getSnapshot(),
        };
      }
      const nextTokens = document.tokens.filter((token) => token.token_id !== tokenId);
      if (nextTokens.length === document.tokens.length) {
        return {
          status: 'error',
          message: '要撤销的访问令牌不存在。',
          snapshot: await this.getSnapshot(),
        };
      }
      await this.writeDocument({
        schema_version: 1,
        tokens: nextTokens,
      });
      return {
        status: 'success',
        message: '访问令牌已撤销。',
        snapshot: await this.getSnapshot(),
      };
    });
  }

  private async markLastUsed(tokenId: string, document: StoredTokenDocument): Promise<void> {
    const now = this.nowIso();
    const updated = document.tokens.map((token) => token.token_id === tokenId
      ? shouldWriteLastUsed(token.last_used_at, now)
        ? { ...token, last_used_at: now, updated_at: token.updated_at }
        : token
      : token);
    if (updated.every((token, index) => token === document.tokens[index])) {
      return;
    }
    await this.writeDocument({ schema_version: 1, tokens: updated });
  }

  private async readDocument(): Promise<StoredTokenDocument> {
    if (!await pathExists(this.tokenFilePath)) {
      return { schema_version: 1, tokens: [] };
    }
    const content = await readFile(this.tokenFilePath, 'utf8');
    const parsed = (yaml.parse(content) ?? {}) as Partial<StoredTokenDocument>;
    return {
      schema_version: 1,
      tokens: Array.isArray(parsed.tokens)
        ? parsed.tokens
          .map(normalizeStoredToken)
          .filter((token): token is StoredTokenRecord => token !== null)
        : [],
    };
  }

  private async writeDocument(document: StoredTokenDocument): Promise<void> {
    await mkdir(path.dirname(this.tokenFilePath), { recursive: true });
    const tempPath = `${this.tokenFilePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, yaml.stringify(document), 'utf8');
    await rename(tempPath, this.tokenFilePath);
    await rm(tempPath, { force: true }).catch(() => undefined);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

function normalizeStoredToken(value: unknown): StoredTokenRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const tokenId = typeof record.token_id === 'string' ? record.token_id.trim() : '';
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const salt = typeof record.salt === 'string' ? record.salt.trim() : '';
  const hash = typeof record.hash === 'string' ? record.hash.trim() : '';
  const createdAt = typeof record.created_at === 'string' ? record.created_at.trim() : '';
  const updatedAt = typeof record.updated_at === 'string' ? record.updated_at.trim() : createdAt;
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter(isAccessScope)
    : [];
  if (!tokenId || !label || !salt || !hash || !createdAt || scopes.length === 0) {
    return null;
  }
  return {
    token_id: tokenId,
    label,
    scopes,
    salt,
    hash,
    created_at: createdAt,
    updated_at: updatedAt || createdAt,
    last_used_at: typeof record.last_used_at === 'string' ? record.last_used_at.trim() : undefined,
  };
}

function isAccessScope(value: unknown): value is PersonalServerAccessScope {
  return value === 'surface:read'
    || value === 'surface:write'
    || value === 'tokens:write'
    || value === 'operations:write';
}

function hashToken(token: string, salt: string): string {
  return createHash('sha256').update(`${salt}\0${token}`).digest('hex');
}

function verifyToken(token: string, salt: string, hash: string): boolean {
  return secureEqual(hashToken(token, salt), hash);
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function shouldWriteLastUsed(previous: string | undefined, next: string): boolean {
  if (!previous) return true;
  const previousTime = Date.parse(previous);
  const nextTime = Date.parse(next);
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return true;
  return nextTime - previousTime >= LAST_USED_WRITE_THROTTLE_MS;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
