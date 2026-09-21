import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { BindingStorePort } from '../../binding/binding-store-port.js';
import type { ConversationBinding } from '../../binding/binding.js';

interface BindingRow {
  binding_key: string;
  source_provider_id: string;
  scene_id: string;
  conversation_id: string;
  continuity_id: string;
  thread_id: string;
  recall_scope: ConversationBinding['recall_scope'];
  disclosure_scope: ConversationBinding['disclosure_scope'];
  actor_id: string | null;
  created_at: string;
}

export class SqliteBindingStore implements BindingStorePort {
  private readonly database: Database.Database;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    const migration = resolve(__dirname, '../../../migrations/001-binding.sql');
    this.database.exec(readFileSync(migration, 'utf8'));
  }

  public load(bindingKey: string): ConversationBinding | null {
    const row = this.database.prepare(
      `SELECT binding_key,source_provider_id,scene_id,conversation_id,continuity_id,
              thread_id,recall_scope,disclosure_scope,actor_id,created_at
         FROM conversation_bindings WHERE binding_key=?`,
    ).get(bindingKey) as BindingRow | undefined;
    if (!row) return null;
    return {
      ...row,
      ...(row.actor_id ? { actor_id: row.actor_id } : { actor_id: undefined }),
    };
  }

  public create(binding: ConversationBinding): ConversationBinding {
    this.database.prepare(
      `INSERT OR IGNORE INTO conversation_bindings(
         binding_key,source_provider_id,scene_id,conversation_id,continuity_id,
         thread_id,recall_scope,disclosure_scope,actor_id,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      binding.binding_key,
      binding.source_provider_id,
      binding.scene_id,
      binding.conversation_id,
      binding.continuity_id,
      binding.thread_id,
      binding.recall_scope,
      binding.disclosure_scope,
      binding.actor_id ?? null,
      binding.created_at,
    );
    const persisted = this.load(binding.binding_key);
    if (!persisted) {
      throw new Error(`Conversation Binding 写入后丢失: ${binding.binding_key}`);
    }
    return persisted;
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }
}

