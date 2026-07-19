import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface ProductAuditRecord {
  readonly owner: string;
  readonly module: string;
  readonly action: string;
  readonly target_kind: string;
  readonly target_name?: string | null;
  readonly outcome: 'succeeded' | 'failed' | 'accepted';
  readonly reason?: string | null;
  readonly trace_id?: string | null;
  readonly runtime_id?: string | null;
  readonly attributes?: Record<string, unknown>;
}

export class ProductAuditLog {
  private readonly filePath: string;

  public constructor(observabilityRoot: string) {
    this.filePath = path.join(observabilityRoot, 'logs', 'audit', 'kernel.jsonl');
  }

  public async append(record: ProductAuditRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      owner: record.owner,
      module: record.module,
      action: record.action,
      target_kind: record.target_kind,
      target_name: record.target_name ?? null,
      outcome: record.outcome,
      reason: record.reason ?? null,
      trace_id: record.trace_id ?? null,
      runtime_id: record.runtime_id ?? 'personal-server',
      attributes: record.attributes ?? {},
    })}\n`, 'utf8');
  }
}
