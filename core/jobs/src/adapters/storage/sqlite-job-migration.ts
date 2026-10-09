import Database from 'better-sqlite3';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteJobStore } from './sqlite-job-store.js';

function assertJobSchema(database: Database.Database, version: 4 | 5): void {
  if (database.pragma('application_id', { simple: true }) !== 0x47434a42
    || database.pragma('user_version', { simple: true }) !== version) throw new Error(`Jobs 迁移仅接受原 owner 的 v${version} 库`);
  if (database.pragma('integrity_check', { simple: true }) !== 'ok' || (database.pragma('foreign_key_check') as unknown[]).length !== 0) {
    throw new Error('Jobs 迁移库完整性无效');
  }
  const expected = new Database(':memory:');
  try {
    // 版本DDL随migrations制品提供，所有表/索引/约束一起核验，不依赖测试目录或只猜表名。
    expected.exec(readFileSync(resolve(__dirname, '../../../migrations', version === 4 ? '000-jobs-v4.sql' : '001-jobs.sql'), 'utf8'));
    const objects = (store: Database.Database): unknown[] => (store.prepare(`SELECT type,name,tbl_name,sql
      FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all() as { sql: string }[])
      .map(row => ({ ...row, sql: row.sql.replace(/\s+/g, ' ').trim() }));
    if (JSON.stringify(objects(database)) !== JSON.stringify(objects(expected))) {
      throw new Error(`Jobs v${version} schema 存在未知对象或结构；保留原库，不执行迁移`);
    }
  } finally { expected.close(); }
}

/**
 * 显式生成离线 v5 候选；调用方先停止所有源 writer，并在后续受控切换前验证候选。
 * 只读原 v4 库作为恢复来源，不原位迁移、不覆盖目标、不自动切换 App 路径。
 */
export async function copyJobStoreForAdmissionOrderMigration(sourcePath: string, candidatePath: string): Promise<void> {
  const migrationPath = resolve(__dirname, '../../../migrations/002-admission-order.sql');
  if (resolve(sourcePath) === resolve(candidatePath)) throw new Error('Jobs 迁移候选必须是独立新路径');
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('busy_timeout=5000');
    const sourceDataVersion = source.pragma('data_version', { simple: true });
    const assertSourceUnchanged = (): void => {
      if (source.pragma('data_version', { simple: true }) !== sourceDataVersion) {
        throw new Error('Jobs 源在离线复制窗口仍有写入；候选过期，保持原库并停止 writer 后重试新路径');
      }
    };
    assertJobSchema(source, 4);
    mkdirSync(dirname(candidatePath), { recursive: true });
    // wx 先占有候选文件；并发/重复调用不得让 SQLite backup 覆盖他人的文件。
    closeSync(openSync(candidatePath, 'wx'));
    assertSourceUnchanged();
    await source.backup(candidatePath);
    assertSourceUnchanged();
    const candidate = new Database(candidatePath, { fileMustExist: true });
    try {
      candidate.pragma('foreign_keys=ON');
      candidate.transaction(() => {
        assertJobSchema(candidate, 4);
        candidate.exec(readFileSync(migrationPath, 'utf8'));
        assertJobSchema(candidate, 5);
        // 在同一提交前检查新增窗口，避免将损坏序号以 version5 成功发布。
        const row = candidate.prepare(`SELECT COUNT(*) AS count,COUNT(DISTINCT enqueue_sequence) AS unique_count,
          MIN(enqueue_sequence) AS first,MAX(enqueue_sequence) AS last FROM jobs`).get() as {
          count: number; unique_count: number; first: number | null; last: number | null;
        };
        const sequence = candidate.prepare('SELECT singleton,last_sequence FROM job_enqueue_sequence').all() as { singleton: number; last_sequence: number }[];
        if (candidate.pragma('user_version', { simple: true }) !== 5 || row.count !== row.unique_count
          || row.first !== null && (!Number.isSafeInteger(row.first) || row.first < 1)
          || row.last !== null && (!Number.isSafeInteger(row.last) || row.last > row.count)
          || sequence.length !== 1 || sequence[0].singleton !== 1 || sequence[0].last_sequence !== row.count) {
          throw new Error('Jobs 迁移接纳顺序无效');
        }
      }).immediate();
    } finally { candidate.close(); }
    const checked = new SqliteJobStore(candidatePath);
    checked.close();
    assertSourceUnchanged();
  } finally { source.close(); }
}
