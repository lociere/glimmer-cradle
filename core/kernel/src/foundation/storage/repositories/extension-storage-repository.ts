import { DBManager } from '../db-manager';

type StorageRow = { value_json: string };

/**
 * 扩展沙箱 K/V 存储仓库。
 * 每个扩展拥有独立的命名空间（extension_id），键值以 JSON 形式持久化于 extension_storage 表。
 */
export class ExtensionStorageRepository {
  constructor(private readonly extensionId: string) {}

  async get(key: string): Promise<unknown> {
    const row = DBManager.instance.db
      .prepare('SELECT value_json FROM extension_storage WHERE extension_id = ? AND key = ?')
      .get(this.extensionId, key) as StorageRow | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const valueJson = JSON.stringify(value);
    const now = new Date().toISOString();
    DBManager.instance.db
      .prepare(
        'INSERT OR REPLACE INTO extension_storage (extension_id, key, value_json, updated_at) VALUES (?, ?, ?, ?)'
      )
      .run(this.extensionId, key, valueJson, now);
  }

  async delete(key: string): Promise<void> {
    DBManager.instance.db
      .prepare('DELETE FROM extension_storage WHERE extension_id = ? AND key = ?')
      .run(this.extensionId, key);
  }
}
