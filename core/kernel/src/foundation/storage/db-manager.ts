import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { getLogger } from '../logger/logger';
import { resolveKernelDbPath } from '../utils/path-utils';

const logger = getLogger('db-manager');

export class DBManager {
  private static _instance: DBManager | null = null;
  private _db: Database.Database | null = null;
  private _dbPath = '';
  private _isInitialized = false;

  public static get instance(): DBManager {
    if (!DBManager._instance) {
      DBManager._instance = new DBManager();
    }
    return DBManager._instance;
  }

  private constructor() {}

  public async init(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    this._dbPath = resolveKernelDbPath();
    fs.ensureDirSync(path.dirname(this._dbPath));

    logger.info('打开数据库', { path: this._dbPath });

    this._db = new Database(this._dbPath);
    // Cognition 独占经历、Conversation 与长期记忆；Kernel 只保存 Host 基础设施状态。
    this.initializeExtensionTables();

    this._isInitialized = true;
    logger.info('数据库初始化完成');
  }

  public get db(): Database.Database {
    if (!this._db) {
      throw new Error('数据库未初始化');
    }
    return this._db;
  }

  public getDB(): Database.Database {
    return this.db;
  }

  public transaction<T>(fn: (db: Database.Database) => T): T {
    const database = this.db;
    const tx = database.transaction(() => fn(database));
    return tx();
  }

  public async close(): Promise<void> {
    if (!this._db) {
      return;
    }

    this._db.close();
    this._db = null;
    this._isInitialized = false;
    logger.info('数据库连接已关闭');
  }

  private initializeExtensionTables(): void {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS extension_storage (
      extension_id TEXT NOT NULL,
      key          TEXT NOT NULL,
      value_json   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (extension_id, key)
    )`).run();

  }
}
