import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRunPath } from '../utils/path-utils';

export type LocalEndpointPurpose = 'cognition-rpc' | 'control-surface' | 'avatar-host';

export interface LocalEndpointRecord {
  readonly id: string;
  readonly owner: 'kernel';
  readonly owner_pid: number;
  readonly generation: string;
  readonly purpose: LocalEndpointPurpose;
  readonly endpoint: string;
  readonly published_at: string;
}

export interface LocalEndpointCatalog {
  readonly schema_version: 1;
  readonly generation: string;
  readonly owner_pid: number;
  readonly published_at: string;
  readonly endpoints: LocalEndpointRecord[];
}

/** Kernel-owned catalog for ephemeral, loopback-only process endpoints. */
export class EndpointRegistry {
  private static _instance: EndpointRegistry | null = null;
  private readonly generation = randomUUID();
  private readonly records = new Map<LocalEndpointPurpose, LocalEndpointRecord>();

  public static get instance(): EndpointRegistry {
    EndpointRegistry._instance ??= new EndpointRegistry();
    return EndpointRegistry._instance;
  }

  private constructor() {}

  private get catalogPath(): string {
    return resolveRunPath('host/endpoints.json');
  }

  public async publish(purpose: LocalEndpointPurpose, endpoint: string): Promise<LocalEndpointRecord> {
    assertLoopbackEndpoint(endpoint);
    const record: LocalEndpointRecord = {
      id: `kernel:${purpose}`,
      owner: 'kernel',
      owner_pid: process.pid,
      generation: this.generation,
      purpose,
      endpoint,
      published_at: new Date().toISOString(),
    };
    this.records.set(purpose, record);
    await this.flush();
    return record;
  }

  public get(purpose: LocalEndpointPurpose): LocalEndpointRecord | undefined {
    return this.records.get(purpose);
  }

  public async revoke(purpose: LocalEndpointPurpose): Promise<void> {
    if (!this.records.delete(purpose)) return;
    if (this.records.size === 0) {
      await rm(this.catalogPath, { force: true });
      return;
    }
    await this.flush();
  }

  public async close(): Promise<void> {
    this.records.clear();
    await rm(this.catalogPath, { force: true });
  }

  private async flush(): Promise<void> {
    const catalog: LocalEndpointCatalog = {
      schema_version: 1,
      generation: this.generation,
      owner_pid: process.pid,
      published_at: new Date().toISOString(),
      endpoints: [...this.records.values()].sort((left, right) => left.purpose.localeCompare(right.purpose)),
    };
    await mkdir(path.dirname(this.catalogPath), { recursive: true });
    const temporaryPath = `${this.catalogPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.catalogPath);
  }
}

function assertLoopbackEndpoint(endpoint: string): void {
  if (
    !endpoint.startsWith('tcp://127.0.0.1:')
    && !endpoint.startsWith('ws://127.0.0.1:')
    && !endpoint.startsWith('ws://[::1]:')
  ) {
    throw new Error(`内部端点必须绑定回环地址: ${endpoint}`);
  }
}
