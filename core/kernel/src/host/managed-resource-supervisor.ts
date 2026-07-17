import net from 'node:net';
import path from 'node:path';
import fs from 'fs-extra';
import {
  BuiltInContributionPoint,
  type ManagedResourceContribution,
  type ReadinessGateDeclaration,
  type CapabilityGraphNode,
  type CapabilityNodeState,
  type ReadinessGateSnapshot,
} from '@glimmer-cradle/protocol';
import type { ExtensionLogger } from '../foundation/ports';
import { resolveConfiguredProjectPath, resolveDataDir } from '../foundation/utils/path-utils';

export class ManagedResourceSupervisor {
  public constructor(
    private readonly repoRoot: string,
    private readonly logger: ExtensionLogger,
  ) {}

  public async inspect(
    extensionId: string,
    resources: ManagedResourceContribution[],
  ): Promise<CapabilityGraphNode[]> {
    const snapshots: CapabilityGraphNode[] = [];
    for (const resource of resources) {
      snapshots.push(await this.inspectOne(extensionId, resource));
    }
    return snapshots;
  }

  private async inspectOne(
    extensionId: string,
    resource: ManagedResourceContribution,
  ): Promise<CapabilityGraphNode> {
    const now = new Date().toISOString();
    const packageDir = resource.package?.installDir
      ? resolveConfiguredProjectPath(resource.package.installDir, { repoRoot: this.repoRoot })
      : undefined;
    const processCwd = resource.process?.cwd
      ? resolveConfiguredProjectPath(resource.process.cwd, { repoRoot: this.repoRoot })
      : undefined;
    const packageExists = packageDir ? await fs.pathExists(packageDir) : true;
    const readinessGates = await this.inspectReadinessGates(resource);
    const required = resource.required !== false;
    const state = this.resolveResourceState(resource, packageExists, readinessGates);
    const logDir = path.join(
      resolveDataDir(),
      'observability',
      'logs',
      'application',
      'extensions',
      extensionId,
      resource.id,
    );
    const metadata: Record<string, unknown> = {
      kind: resource.kind,
      package_dir: packageDir,
      work_dir: processCwd,
      endpoint: firstGateEndpoint(resource),
      recovery_actions: recoveryActions(resource, state),
    };
    if (resource.kind === 'managedProcess') metadata.log_dir = logDir;

    return {
      id: resource.id,
      contribution_point: resource.kind === 'protocolBridge'
        ? BuiltInContributionPoint.protocolBridge
        : BuiltInContributionPoint.managedResource,
      kind: resource.kind,
      title: resource.displayName || resource.title || resource.id,
      description: resource.description,
      state,
      owner: 'extension',
      owner_id: extensionId,
      audience: resource.audience ?? 'host',
      required,
      summary: summarizeResource(resource, state, packageExists, readinessGates),
      permissions: [...resource.permissions],
      readiness_gates: readinessGates,
      diagnostic_refs: [],
      metadata,
      updated_at: now,
    };
  }

  private async inspectReadinessGates(resource: ManagedResourceContribution): Promise<ReadinessGateSnapshot[]> {
    const gates = normalizeReadinessGates(resource);
    const snapshots: ReadinessGateSnapshot[] = [];
    for (const gate of gates) {
      snapshots.push(await this.inspectReadinessGate(resource.id, gate));
    }
    return snapshots;
  }

  private async inspectReadinessGate(
    resourceId: string,
    gate: ReadinessGateDeclaration,
  ): Promise<ReadinessGateSnapshot> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const endpoint = gate.endpoint?.trim();
    if (!endpoint || gate.type === 'none') {
      return {
        id: gate.id ?? `${resourceId}:${gate.kind}`,
        kind: gate.kind,
        state: 'declared',
        summary: 'readiness gate 已声明，但没有可执行端点。',
        checked_at: checkedAt,
      };
    }

    try {
      if (gate.type === 'http') {
        await this.probeHttp(endpoint, gate.timeoutMs ?? 1800);
      } else if (gate.type === 'tcp' || gate.type === 'websocket' || gate.type === 'onebot11') {
        await this.probeNetwork(endpoint, gate.timeoutMs ?? 1800);
      } else {
        return {
          id: gate.id ?? `${resourceId}:${gate.kind}`,
          kind: gate.kind,
          state: 'declared',
          summary: `暂不支持 ${gate.type} readiness gate。`,
          endpoint,
          checked_at: checkedAt,
        };
      }
      return {
        id: gate.id ?? `${resourceId}:${gate.kind}`,
        kind: gate.kind,
        state: gate.kind === 'readiness' || gate.kind === 'management' ? 'ready' : 'live',
        summary: 'readiness gate 已通过。',
        endpoint,
        checked_at: checkedAt,
        latency_ms: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('扩展受管资源 readiness gate 失败', {
        gate_kind: gate.kind,
        endpoint,
        error: message,
      });
      return {
        id: gate.id ?? `${resourceId}:${gate.kind}`,
        kind: gate.kind,
        state: 'failed',
        summary: message,
        endpoint,
        checked_at: checkedAt,
        latency_ms: Date.now() - startedAt,
        error_message: message,
      };
    }
  }

  private resolveResourceState(
    resource: ManagedResourceContribution,
    packageExists: boolean,
    gates: ReadinessGateSnapshot[],
  ): CapabilityNodeState {
    const required = resource.required !== false;
    if (!packageExists) return required ? 'failed' : 'degraded';
    if (!gates.length) return resource.kind === 'package' ? 'ready' : 'declared';
    if (gates.some((gate) => gate.state === 'failed')) return required ? 'failed' : 'degraded';
    if (gates.some((gate) => gate.state === 'ready')) return 'ready';
    if (gates.some((gate) => gate.state === 'live')) return 'live';
    return 'declared';
  }

  private async probeHttp(endpoint: string, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private probeNetwork(endpoint: string, timeoutMs: number): Promise<void> {
    const parsed = parseNetworkEndpoint(endpoint);
    if (!parsed) return Promise.reject(new Error(`无法解析端点 ${endpoint}`));
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(parsed.port, parsed.host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`连接 ${parsed.host}:${parsed.port} 超时`));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`无法连接 ${parsed.host}:${parsed.port} (${error.message})`));
      });
    });
  }

}

function normalizeReadinessGates(resource: ManagedResourceContribution): ReadinessGateDeclaration[] {
  if (Array.isArray(resource.readinessGates) && resource.readinessGates.length > 0) {
    return resource.readinessGates;
  }
  if (!resource.readiness) return [];
  return [{
    kind: 'readiness',
    type: resource.readiness.type,
    endpoint: resource.readiness.endpoint,
    action: resource.readiness.action,
    timeoutMs: resource.readiness.timeoutMs,
  }];
}

function summarizeResource(
  resource: ManagedResourceContribution,
  state: CapabilityNodeState,
  packageExists: boolean,
  gates: ReadinessGateSnapshot[],
): string {
  const label = resource.displayName || resource.title || resource.id;
  if (!packageExists) return `${label} 安装目录缺失。`;
  const failed = gates.find((gate) => gate.state === 'failed');
  if (failed) return `${label} ${failed.kind} readiness gate 失败：${failed.summary}`;
  if (state === 'ready') return `${label} 已就绪。`;
  if (state === 'live') return `${label} 已存活，等待业务 ready。`;
  if (state === 'declared') return `${label} 已声明，等待启动或 readiness gate。`;
  return `${label} 状态：${state}`;
}

function recoveryActions(resource: ManagedResourceContribution, state: CapabilityNodeState): string[] {
  const label = resource.displayName || resource.title || resource.id;
  if (state === 'failed') return [`检查 ${label} 进程、端点和日志。`];
  if (state === 'degraded') return [`确认 ${label} 是否为可选资源。`];
  return [];
}

function firstGateEndpoint(resource: ManagedResourceContribution): string | undefined {
  return resource.readinessGates?.find((gate) => gate.endpoint)?.endpoint ?? resource.readiness?.endpoint;
}

function parseNetworkEndpoint(endpoint: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(endpoint);
    const port = Number(parsed.port || (parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 443 : 80));
    return { host: normalizeLocalHost(parsed.hostname), port };
  } catch {
    const match = endpoint.match(/^([^:]+):(\d+)$/);
    if (!match) return null;
    return { host: normalizeLocalHost(match[1]), port: Number(match[2]) };
  }
}

function normalizeLocalHost(host: string): string {
  const value = host.replace(/^\[(.*)\]$/, '$1');
  return value === 'localhost' || value === '::1' ? '127.0.0.1' : value;
}
