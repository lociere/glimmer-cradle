import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
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

interface DeploymentRunner {
  readonly command: string | null;
  readonly stateRoot: string | null;
  readonly disabledReason: string;
}

interface DeploymentOperationLease {
  readonly operationId: string;
  readonly operation: string;
}

export class DeploymentOperationsService {
  private activeLease: DeploymentOperationLease | null = null;

  public constructor(
    private readonly options: {
      readonly applicationRoot: string;
      readonly packageRoot?: string;
      readonly fetchFn?: typeof fetch;
      readonly cliPath?: string;
      readonly deploymentEnvFile?: string;
      readonly releaseSource?: string;
      readonly spawnDetachedFn?: (
        lease: DeploymentOperationLease,
        command: string,
        args: string[],
      ) => Promise<void>;
    },
  ) {}

  public async getSnapshot(availableVersion?: string): Promise<DeploymentOperationsSnapshot> {
    const runner = await this.resolveRunner();
    const entries = await this.listBackups(runner.stateRoot);
    return {
      backup: {
        supported: Boolean(runner.command),
        disabled_reason: runner.command ? undefined : runner.disabledReason,
        backup_root: runner.stateRoot ? path.join(runner.stateRoot, 'backups') : undefined,
        entries,
      },
      service: {
        restart_supported: Boolean(runner.command),
        stop_supported: Boolean(runner.command),
        disabled_reason: runner.command ? undefined : runner.disabledReason,
      },
      update: {
        check_supported: true,
        apply_supported: Boolean(runner.command),
        current_version: await this.readCurrentVersion(),
        source: this.resolveReleaseSource(),
        disabled_reason: runner.command ? undefined : runner.disabledReason,
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

    const runner = await this.resolveRunner();
    if (!runner.command) {
      return {
        status: 'disabled',
        message: runner.disabledReason,
        snapshot: await this.getSnapshot(),
      };
    }

    const lease = this.acquireLease(operation);
    if (!lease) {
      return {
        status: 'conflict',
        message: '当前已有部署级运维事务在进行中，请等待前一项操作结束。',
        snapshot: await this.getSnapshot(),
      };
    }

    if (operation === 'backup.create') {
      return this.runBlocking(lease, runner, ['backup'], '备份已创建。');
    }
    if (operation === 'backup.restore') {
      const backupId = request.backup_id?.trim() || '';
      if (!await this.hasBackup(runner.stateRoot, backupId)) {
        this.releaseLease(lease.operationId);
        return {
          status: 'error',
          message: '指定备份不存在，无法恢复。',
          snapshot: await this.getSnapshot(),
        };
      }
      if (request.confirm !== true) {
        this.releaseLease(lease.operationId);
        return {
          status: 'preflight',
          message: `恢复 ${backupId} 将中断当前服务，并在失败时依赖部署事务回滚。`,
          requires_confirmation: true,
          snapshot: await this.getSnapshot(),
        };
      }
      return this.runDetached(
        lease,
        runner.command,
        ['restore', backupId],
        `已接受恢复请求 ${backupId}，页面连接将随后中断。`,
      );
    }
    if (operation === 'service.restart') {
      return this.runDetached(
        lease,
        runner.command,
        ['restart'],
        '已接受重启请求，当前控制面连接将重新建立。',
      );
    }
    if (operation === 'service.stop') {
      return this.runDetached(
        lease,
        runner.command,
        ['stop'],
        '已接受停机请求，当前控制面连接将被关闭。',
      );
    }
    if (operation === 'update.apply') {
      if (request.confirm !== true) {
        this.releaseLease(lease.operationId);
        return {
          status: 'preflight',
          message: '更新将触发部署级事务、就绪门与失败回滚；确认后当前连接可能中断。',
          requires_confirmation: true,
          snapshot: await this.getSnapshot(),
        };
      }
      return this.runDetached(
        lease,
        runner.command,
        ['update'],
        '已接受更新请求，当前控制面连接将根据部署事务状态中断或恢复。',
      );
    }

    this.releaseLease(lease.operationId);
    return {
      status: 'error',
      message: '未知的运维操作。',
      snapshot: await this.getSnapshot(),
    };
  }

  private async runBlocking(
    lease: DeploymentOperationLease,
    runner: DeploymentRunner,
    args: string[],
    successMessage: string,
  ): Promise<DeploymentOperationResult> {
    try {
      await this.runCommand(runner.command || '', args);
      return {
        status: 'success',
        message: successMessage,
        snapshot: await this.getSnapshot(),
        operation_id: lease.operationId,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        snapshot: await this.getSnapshot(),
        operation_id: lease.operationId,
      };
    } finally {
      this.releaseLease(lease.operationId);
    }
  }

  private async runDetached(
    lease: DeploymentOperationLease,
    command: string,
    args: string[],
    acceptedMessage: string,
  ): Promise<DeploymentOperationResult> {
    try {
      await this.spawnDetached(lease, command, args);
      return {
        status: 'accepted',
        message: acceptedMessage,
        snapshot: await this.getSnapshot(),
        operation_id: lease.operationId,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        snapshot: await this.getSnapshot(),
        operation_id: lease.operationId,
      };
    }
  }

  private async resolveRunner(): Promise<DeploymentRunner> {
    const cliPath = normalizeConfiguredPath(this.options.cliPath);
    if (cliPath && await fileExists(cliPath)) {
      return {
        command: cliPath,
        stateRoot: await this.resolveStateRoot(),
        disabledReason: '',
      };
    }
    if (cliPath) {
      return {
        command: null,
        stateRoot: await this.resolveStateRoot(),
        disabledReason: `已配置宿主运维桥，但桥接命令不存在：${cliPath}`,
      };
    }
    return {
      command: null,
      stateRoot: await this.resolveStateRoot(),
      disabledReason: '当前 Product Host 未配置部署级 glimmer-cradle 运维桥；备份、恢复、更新与服务控制仅在安装环境中可用。',
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
    const backupRoot = path.join(stateRoot, 'backups');
    if (!await fileExists(backupRoot)) return [];
    const entries = await readdir(backupRoot, { withFileTypes: true });
    const backups = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const envPath = path.join(backupRoot, entry.name, 'deployment.env');
      const status = await this.readBackupStatus(envPath);
      backups.push({
        backup_id: entry.name,
        created_at: entry.name,
        status,
      });
    }
    return backups.sort((left, right) => right.backup_id.localeCompare(left.backup_id));
  }

  private async hasBackup(stateRoot: string | null, backupId: string): Promise<boolean> {
    if (!stateRoot) return false;
    const backupDir = resolveBackupDirectory(stateRoot, backupId);
    if (!backupDir) return false;
    const entries = await this.listBackups(stateRoot);
    if (!entries.some((entry) => entry.backup_id === backupId)) {
      return false;
    }
    return fileExists(backupDir);
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

  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.options.applicationRoot,
        stdio: 'ignore',
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`运维命令 ${args.join(' ')} 失败，退出码 ${code ?? 'null'}。`));
      });
    });
  }

  private spawnDetached(
    lease: DeploymentOperationLease,
    command: string,
    args: string[],
  ): Promise<void> {
    if (this.options.spawnDetachedFn) {
      return this.options.spawnDetachedFn(lease, command, args);
    }
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.options.applicationRoot,
        detached: true,
        stdio: 'ignore',
      });
      child.once('error', (error) => {
        this.releaseLease(lease.operationId);
        reject(error);
      });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  private acquireLease(operation: string): DeploymentOperationLease | null {
    if (this.activeLease) return null;
    const lease = {
      operationId: `deployment_op_${randomUUID()}`,
      operation,
    };
    this.activeLease = lease;
    return lease;
  }

  private releaseLease(operationId: string): void {
    if (this.activeLease?.operationId === operationId) {
      this.activeLease = null;
    }
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

function normalizeConfiguredPath(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function resolveBackupDirectory(stateRoot: string, backupId: string): string | null {
  const normalized = backupId.trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z_-]{0,127}$/.test(normalized)) {
    return null;
  }
  const backupRoot = path.resolve(stateRoot, 'backups');
  const candidate = path.resolve(backupRoot, normalized);
  const relative = path.relative(backupRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}
