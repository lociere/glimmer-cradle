import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const DEPLOYMENT_OPERATION_ID = /^deployment_op_[A-Za-z0-9][A-Za-z0-9._-]{0,111}$/;
const DEPLOYMENT_OPERATION_STATUSES = new Set<DeploymentOperationStatus>([
  'unsupported',
  'accepted',
  'started',
  'committed',
  'failed',
  'recovery_required',
  'owner_timeout',
  'conflict',
  'error',
]);

export type DeploymentOperationStatus =
  | 'unsupported'
  | 'accepted'
  | 'started'
  | 'committed'
  | 'failed'
  | 'recovery_required'
  | 'owner_timeout'
  | 'conflict'
  | 'error';

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
  readonly status: DeploymentOperationStatus;
  readonly message: string;
  readonly snapshot: DeploymentOperationsSnapshot;
  readonly requires_confirmation?: boolean;
  readonly operation_id: string;
  readonly operation?: string;
  readonly exit_code?: number;
  readonly recovery_action?: string;
  readonly updated_at?: string;
}

export interface DeploymentOperationRequest {
  readonly operation?: string;
  readonly operation_id?: string;
  readonly backup_id?: string;
  readonly confirm?: boolean;
}

export class DeploymentOperationsService {
  public constructor(
    private readonly options: {
      readonly applicationRoot: string;
      readonly packageRoot?: string;
      readonly deploymentEnvFile?: string;
      readonly releaseSource?: string;
      readonly bridgeSocketPath?: string;
      readonly bridgeToken?: string;
      readonly bridgeTransport?: <T>(
        method: 'GET' | 'POST',
        route: string,
        body?: unknown,
      ) => Promise<T | null>;
    },
  ) {}

  public async getSnapshot(availableVersion?: string): Promise<DeploymentOperationsSnapshot> {
    const bridgeSnapshot = await this.bridgeRequest<DeploymentOperationsSnapshot>('GET', '/snapshot').catch(() => null);
    if (bridgeSnapshot) {
      return {
        ...bridgeSnapshot,
        update: {
          ...bridgeSnapshot.update,
          check_supported: false,
          apply_supported: false,
          disabled_reason: '尚未建立经验证候选、固定 OCI digest 与 install-release 的不可漂移绑定。',
          available_version: availableVersion,
        },
      };
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
        check_supported: false,
        apply_supported: false,
        current_version: await this.readCurrentVersion(),
        source: this.resolveReleaseSource(),
        disabled_reason: '尚未建立经验证候选、固定 OCI digest 与 install-release 的不可漂移绑定。',
        available_version: availableVersion,
      },
    };
  }

  public async execute(request: DeploymentOperationRequest): Promise<DeploymentOperationResult> {
    const operationId = request.operation_id?.trim() || `deployment_op_${randomUUID()}`;
    if (!DEPLOYMENT_OPERATION_ID.test(operationId)) {
      return this.localResult(
        'error',
        'operation_id 无效；请求未发送给部署桥。',
        operationId,
        request.operation,
      );
    }
    const bridgeRequest = { ...request, operation_id: operationId };

    if (this.hasBridgeConfiguration()) {
      try {
        const bridgeResult = await this.bridgeRequest<DeploymentOperationResult>('POST', '/operations', bridgeRequest);
        if (bridgeResult) {
          if (bridgeResult.operation_id !== operationId
            || !DEPLOYMENT_OPERATION_STATUSES.has(bridgeResult.status)) {
            return this.localResult(
              'error',
              '部署桥返回了不匹配的 operation_id；请求状态拒绝投影。',
              operationId,
              request.operation,
            );
          }
          if ((request.operation === 'update.check' || request.operation === 'update.apply')
            && bridgeResult.status !== 'unsupported') {
            return this.localResult(
              'error',
              '部署桥没有按当前契约拒绝未绑定候选的更新请求；结果失败闭合。',
              operationId,
              request.operation,
            );
          }
          return bridgeResult;
        }
      } catch {
        return this.localResult(
          'error',
          '部署级运维桥不可达；为避免重复执行，当前请求没有回退到其他执行路径。',
          operationId,
          request.operation,
        );
      }
    }

    return this.localResult(
      request.operation === 'update.check' || request.operation === 'update.apply'
        ? 'unsupported'
        : 'error',
      request.operation === 'update.check' || request.operation === 'update.apply'
        ? '更新能力未连接可信候选 owner；请求失败闭合。'
        : '当前 Product Host 未连接部署级外部事务 owner；请求未执行。',
      operationId,
      request.operation,
    );
  }

  public async getOperation(operationId: string): Promise<DeploymentOperationResult | null> {
    if (!DEPLOYMENT_OPERATION_ID.test(operationId) || !this.hasBridgeConfiguration()) return null;
    try {
      const result = await this.bridgeRequest<DeploymentOperationResult>(
        'GET',
        `/operations/${encodeURIComponent(operationId)}`,
      );
      if (!result) return null;
      // `ready` 是 Bridge 内部的 pre-ack 状态；它不能投影成 API accepted。
      // 调用者保留同一 operation_id 继续查询，直到 started 或规范终态出现。
      if ((result.status as string) === 'ready' && result.operation_id === operationId) return null;
      if (result.operation_id !== operationId
        || !DEPLOYMENT_OPERATION_STATUSES.has(result.status)) {
        return {
          status: 'error',
          message: '部署桥返回了不匹配的 operation 终态；查询结果失败闭合。',
          snapshot: await this.getSnapshot(),
          operation_id: operationId,
        };
      }
      return result;
    } catch {
      return {
        status: 'error',
        message: '部署级运维桥不可达；operation 终态暂不可查询。',
        snapshot: await this.getSnapshot(),
        operation_id: operationId,
      };
    }
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
    if (this.options.bridgeTransport) {
      return this.options.bridgeTransport<T>(method, route, body);
    }
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
          if (response.statusCode === 404) {
            resolve(null);
            return;
          }
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
    return Boolean(
      this.options.bridgeTransport
      || (this.options.bridgeSocketPath?.trim() && this.options.bridgeToken?.trim()),
    );
  }

  private async localResult(
    status: DeploymentOperationStatus,
    message: string,
    operationId: string,
    operation?: string,
  ): Promise<DeploymentOperationResult> {
    return {
      status,
      message,
      snapshot: await this.getSnapshot(),
      operation_id: operationId,
      operation,
    };
  }

}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
