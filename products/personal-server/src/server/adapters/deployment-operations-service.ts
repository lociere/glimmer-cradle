import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface DeploymentBackupEntry {
  readonly backup_id: string;
  readonly created_at: string;
  readonly status: string;
}

export interface DeploymentOperationsSnapshot {
  readonly backup: {
    readonly supported: boolean;
    readonly disabled_reason?: string;
    readonly backup_root?: string;
    readonly entries: ReadonlyArray<DeploymentBackupEntry>;
  };
  readonly service: {
    readonly restart_supported: boolean;
    readonly stop_supported: boolean;
    readonly disabled_reason?: string;
  };
  readonly update: {
    readonly check_supported: boolean;
    readonly apply_supported: boolean;
    readonly current_version: string;
    readonly source: string;
    readonly disabled_reason?: string;
    readonly available_version?: string;
  };
}

export interface DeploymentOperationResult {
  readonly status: 'success' | 'error' | 'accepted' | 'disabled' | 'preflight' | 'conflict';
  readonly message: string;
  readonly snapshot: DeploymentOperationsSnapshot;
  readonly requires_confirmation?: boolean;
  readonly operation_id?: string;
}

export class DeploymentOperationsService {
  public constructor(
    private readonly options: {
      readonly applicationRoot: string;
      readonly packageRoot?: string;
      readonly fetchFn?: typeof fetch;
      readonly deploymentEnvFile?: string;
      readonly releaseSource?: string;
      readonly bridgeSocketPath?: string;
      readonly bridgeToken?: string;
    },
  ) {}

  public async getSnapshot(availableVersion?: string): Promise<DeploymentOperationsSnapshot> {
    const bridgeSnapshot = await this.bridgeRequest<DeploymentOperationsSnapshot>('GET', '/snapshot').catch(() => null);
    if (bridgeSnapshot) {
      return availableVersion
        ? { ...bridgeSnapshot, update: { ...bridgeSnapshot.update, available_version: availableVersion } }
        : bridgeSnapshot;
    }
    const stateRoot = await this.resolveStateRoot();
    const disabledReason = '当前 Product Host 未连接部署级外部事务 owner；宿主写操作不可用。';
    const entries = await this.listBackups(stateRoot);
    return {
      backup: {
        supported: false,
        disabled_reason: disabledReason,
        backup_root: stateRoot ? path.join(stateRoot, 'data', 'backups') : undefined,
        entries,
      },
      service: {
        restart_supported: false,
        stop_supported: false,
        disabled_reason: disabledReason,
      },
      update: {
        check_supported: true,
        apply_supported: false,
        current_version: await this.readCurrentVersion(),
        source: this.resolveReleaseSource(),
        disabled_reason: disabledReason,
        available_version: availableVersion,
      },
    };
  }

  public async execute(request: { operation?: string; backup_id?: string; confirm?: boolean }): Promise<DeploymentOperationResult> {
    const operation = request.operation || '';
    if (operation === 'update.check') {
      const availableVersion = await this.checkLatestVersion().catch(() => undefined);
      return {
        status: 'success',
        message: availableVersion ? `检测到候选版本 ${availableVersion}。` : '当前未发现新的候选版本。',
        snapshot: await this.getSnapshot(availableVersion),
      };
    }

    if (this.hasBridgeConfiguration()) {
      try {
        const bridgeResult = await this.bridgeRequest<DeploymentOperationResult>('POST', '/operations', request);
        if (bridgeResult) return bridgeResult;
      } catch {
        return {
          status: 'error',
          message: '部署级运维桥不可达；为避免重复执行，当前请求没有回退到其他执行路径。',
          snapshot: await this.getSnapshot(),
          operation_id: `deployment_op_${randomUUID()}`,
        };
      }
    }

    return {
      status: 'disabled',
      message: '当前 Product Host 未连接部署级外部事务 owner；请求未执行。',
      snapshot: await this.getSnapshot(),
    };
  }

  private async resolveStateRoot(): Promise<string | null> {
    if (process.env.GLIMMER_CRADLE_STATE_ROOT?.trim()) {
      return process.env.GLIMMER_CRADLE_STATE_ROOT.trim();
    }
    const envFile = this.options.deploymentEnvFile
      || process.env.GLIMMER_CRADLE_DEPLOYMENT_ENV_FILE
      || null;
    if (!envFile || !await fileExists(envFile)) {
      return null;
    }
    const content = await readFile(envFile, 'utf8');
    const match = content.match(/^GLIMMER_CRADLE_STATE_ROOT=(.+)$/m);
    return match?.[1]?.trim() || null;
  }

  private async listBackups(stateRoot: string | null): Promise<DeploymentBackupEntry[]> {
    if (!stateRoot) return [];
    const backupRoot = path.join(stateRoot, 'data', 'backups');
    if (!await fileExists(backupRoot)) return [];
    const backups = [];
    for (const kind of ['manual', 'transaction', 'restore-safety']) {
      const kindRoot = path.join(backupRoot, kind);
      if (!await fileExists(kindRoot)) continue;
      const entries = await readdir(kindRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        backups.push({
          backup_id: entry.name,
          created_at: entry.name,
          status: await this.readBackupStatus(path.join(kindRoot, entry.name, 'deployment.env')),
        });
      }
    }
    return backups.sort((left, right) => right.backup_id.localeCompare(left.backup_id));
  }

  private async readBackupStatus(filePath: string): Promise<string> {
    if (!await fileExists(filePath)) return 'unknown';
    const content = await readFile(filePath, 'utf8');
    return content.match(/^status=(.+)$/m)?.[1]?.trim() || 'unknown';
  }

  private async readCurrentVersion(): Promise<string> {
    for (const packageJsonPath of [
      this.options.packageRoot ? path.join(this.options.packageRoot, 'package.json') : null,
      path.join(this.options.applicationRoot, 'package.json'),
    ]) {
      if (!packageJsonPath || !await fileExists(packageJsonPath)) continue;
      try {
        const content = await readFile(packageJsonPath, 'utf8');
        return JSON.parse(content).version || 'unknown';
      } catch {
        continue;
      }
    }
    return 'unknown';
  }

  private resolveReleaseSource(): string {
    return this.options.releaseSource
      || process.env.GLIMMER_CRADLE_RELEASE_SOURCE
      || 'https://github.com/lociere/glimmer-cradle/releases/latest/download';
  }

  private bridgeRequest<T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T | null> {
    const socketPath = this.options.bridgeSocketPath?.trim();
    const token = this.options.bridgeToken?.trim();
    if (!socketPath || !token) return Promise.resolve(null);
    const payload = body === undefined ? '' : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath,
        path: route,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
        timeout: 10_000,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode >= 500) {
            reject(new Error(`operations_bridge_${response.statusCode || 'unknown'}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch (error) {
            reject(error);
          }
        });
      });
      request.once('timeout', () => request.destroy(new Error('operations_bridge_timeout')));
      request.once('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  private hasBridgeConfiguration(): boolean {
    return Boolean(this.options.bridgeSocketPath?.trim() && this.options.bridgeToken?.trim());
  }

  private async checkLatestVersion(): Promise<string | undefined> {
    const source = this.resolveReleaseSource();
    if (!source) return undefined;
    if (source.startsWith('https://github.com/lociere/glimmer-cradle/releases/latest')) {
      const response = await (this.options.fetchFn ?? fetch)('https://api.github.com/repos/lociere/glimmer-cradle/releases/latest', {
        headers: { accept: 'application/vnd.github+json' },
      });
      if (!response.ok) return undefined;
      const payload = await response.json() as { tag_name?: string };
      return payload.tag_name?.replace(/^v/, '') || undefined;
    }
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await (this.options.fetchFn ?? fetch)(`${source.replace(/\/$/, '')}/SHA256SUMS`);
      if (!response.ok) return undefined;
      return parseVersionFromChecksums(await response.text());
    }
    const localChecksums = path.join(source.replace(/^file:\/\//, ''), 'SHA256SUMS');
    if (!await fileExists(localChecksums)) return undefined;
    return parseVersionFromChecksums(await readFile(localChecksums, 'utf8'));
  }

}

function parseVersionFromChecksums(content: string): string | undefined {
  return content.match(/glimmer-cradle-personal-server-v([0-9A-Za-z._+-]+)-linux-amd64(?:-full)?\.tar\.gz/)?.[1];
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
