import path from 'node:path';

export interface HostRoots {
  readonly app_root: string;
  readonly config_root: string;
  readonly data_root: string;
}

/** 产品/部署注入唯一根；此 resolver 不创建目录、不读取 CWD、不迁移用户数据。 */
export class HostDataPaths implements HostRoots {
  public readonly app_root: string;
  public readonly config_root: string;
  public readonly data_root: string;
  public readonly host_config: string;
  public readonly jobs_config: string;
  public readonly memory_config: string;
  public readonly authority_database: string;
  public readonly jobs_database: string;
  public readonly worker_console: string;
  public constructor(roots: HostRoots) {
    if (![roots.app_root, roots.config_root, roots.data_root].every(value => typeof value === 'string' && path.isAbsolute(value))) {
      throw new Error('Host 根路径必须显式为绝对路径');
    }
    this.app_root = path.resolve(roots.app_root);
    this.config_root = path.resolve(roots.config_root);
    this.data_root = path.resolve(roots.data_root);
    this.host_config = path.join(this.config_root, 'system/host.yaml');
    this.jobs_config = path.join(this.config_root, 'system/jobs.yaml');
    // 现行 Memory Document/YAML 唯一入口；阶段 11 原子切换到 Cognition owner 后删除此旧路径。
    this.memory_config = path.join(this.config_root, 'system/memory.yaml');
    this.authority_database = path.join(this.data_root, 'state/platform/authority.sqlite');
    this.jobs_database = path.join(this.data_root, 'state/jobs/jobs.sqlite');
    // 复用当前可观测性路径；新 Data Layout/诊断 consumer 在阶段 14 一起迁移。
    this.worker_console = path.join(this.data_root, 'observability/logs/application/cognition.console.log');
    Object.freeze(this);
  }
}
