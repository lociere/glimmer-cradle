import type {
  SkillDescriptor,
  SkillPolicy,
  SkillProvider,
  SkillProviderRef,
  SkillProviderRuntimeSnapshot,
  SkillRegistrationTarget,
} from '../../types';
import type { McpServerConfig } from '@glimmer-cradle/protocol';
import { ConfigManager } from '../../../../foundation/config/config-manager';
import { getLogger } from '../../../../foundation/logger/logger';
import { RuntimeReadinessCatalogStore } from '../../../../foundation/runtime-readiness-catalog';
import type { RuntimeReadinessSnapshot } from '../../../../foundation/runtime-readiness';
import {
  McpServerConnection,
  type McpCapabilitySnapshot,
  type McpResourceDefinition,
  type McpServerConnectionTarget,
  type McpToolDefinition,
} from './mcp-server-connection';
import { buildMcpRuntimeReadinessSnapshots } from './mcp-server-runtime-readiness';

export const MCP_SERVER_SKILL_PROVIDER: SkillProviderRef = {
  kind: 'mcp_server',
  id: 'mcp-servers',
};

export type { McpServerConnectionTarget } from './mcp-server-connection';

export type McpServerConnectionState = 'connecting' | 'ready' | 'unavailable' | 'stopped';

export interface McpServerConnectionStatus {
  id: string;
  transport: McpServerConnectionTarget['transport'];
  state: McpServerConnectionState;
  skillId: string;
  error?: string;
}

const logger = getLogger('mcp-server-skill-provider');

export class McpServerSkillProvider implements SkillProvider {
  private static _instance: McpServerSkillProvider | null = null;
  private readonly _registeredSkillIds = new Set<string>();
  private readonly _connectionTargets = new Map<string, McpServerConnectionTarget>();
  private readonly _connections = new Map<string, McpServerConnection>();
  private readonly _statuses = new Map<string, McpServerConnectionStatus>();
  private readonly _capabilityStats = new Map<string, {
    displayName: string;
    skillCount: number;
    toolCount: number;
    resourceCount: number;
    promptCount: number;
    updatedAt: string;
  }>();
  private readonly _pendingConnections = new Set<Promise<void>>();
  private _registrationTarget: SkillRegistrationTarget | null = null;
  public readonly provider = MCP_SERVER_SKILL_PROVIDER;

  public static get instance(): McpServerSkillProvider {
    if (!McpServerSkillProvider._instance) {
      McpServerSkillProvider._instance = new McpServerSkillProvider();
    }
    return McpServerSkillProvider._instance;
  }

  public constructor(
    private readonly _configSource: () => { mcp_servers: McpServerConfig[] } = () =>
      ConfigManager.instance.getConfig().system.skill_plane,
    private readonly _productId: 'desktop' | 'personal-server' = 'desktop',
  ) {}

  public start(target: SkillRegistrationTarget): void {
    const config = this._configSource();
    const enabledServers = config.mcp_servers.filter((server) => (
      server.enabled
      && ((server.products ?? ['any']).includes('any') || (server.products ?? []).includes(this._productId))
    ));

    this._registrationTarget = target;
    this._connectionTargets.clear();
    this._statuses.clear();
    for (const server of enabledServers) {
      const connectionTarget = this.toConnectionTarget(server);
      if (!connectionTarget) {
        continue;
      }
      const skillId = this.toSkillId(connectionTarget);
      if (Array.from(this._connectionTargets.values()).some((item) => this.toSkillId(item) === skillId)) {
        logger.warn('MCP server capability_prefix 重复，已跳过后续目标', {
          server_id: connectionTarget.id,
          capability_prefix: connectionTarget.capabilityPrefix,
        });
        continue;
      }
      this._connectionTargets.set(connectionTarget.id, connectionTarget);
      this.setStatus(connectionTarget, 'connecting');
      this.trackConnection(this.connectTarget(connectionTarget));
    }

    logger.info('MCP Server Provider 生命周期已启动', {
      configured_count: config.mcp_servers.length,
      enabled_count: enabledServers.length,
      product_id: this._productId,
      connectable_count: this._connectionTargets.size,
      mode: 'background_connect',
    });
    this.syncRuntimeReadiness();
  }

  public async stop(target: SkillRegistrationTarget): Promise<void> {
    this._registrationTarget = null;
    await Promise.allSettled(Array.from(this._connections.values()).map((connection) => connection.close()));
    this._connections.clear();

    for (const skillId of this._registeredSkillIds) {
      target.unregisterSkill(skillId);
    }
    this._registeredSkillIds.clear();
    for (const connectionTarget of this._connectionTargets.values()) {
      this._capabilityStats.delete(connectionTarget.id);
      this.setStatus(connectionTarget, 'stopped');
    }
    this._connectionTargets.clear();
    this.syncRuntimeReadiness();
    logger.info('MCP Server Provider 生命周期已停止');
  }

  public listSkills(): SkillDescriptor[] {
    return [];
  }

  public listConnectionTargets(): McpServerConnectionTarget[] {
    return Array.from(this._connectionTargets.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  public listConnectionStatuses(): McpServerConnectionStatus[] {
    return Array.from(this._statuses.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  public getProviderRuntimeSnapshots(): SkillProviderRuntimeSnapshot[] {
    return this.listConnectionTargets().map((target) => {
      const status = this._statuses.get(target.id) ?? {
        id: target.id,
        transport: target.transport,
        state: 'connecting' as const,
        skillId: this.toSkillId(target),
      };
      return this.toProviderRuntimeSnapshot(target, status);
    });
  }

  public getReadinessSnapshots(): RuntimeReadinessSnapshot[] {
    return buildMcpRuntimeReadinessSnapshots(this.getProviderRuntimeSnapshots());
  }

  public async waitForPendingConnections(): Promise<void> {
    await Promise.allSettled(Array.from(this._pendingConnections));
  }

  private toConnectionTarget(server: McpServerConfig): McpServerConnectionTarget | null {
    if (server.transport === 'stdio' && !server.command) {
      logger.warn('MCP server 缺少 stdio command，已跳过', { server_id: server.id });
      return null;
    }

    if ((server.transport === 'http' || server.transport === 'websocket') && !server.url) {
      logger.warn('MCP server 缺少服务 URL，已跳过', {
        server_id: server.id,
        transport: server.transport,
      });
      return null;
    }

    return {
      id: server.id,
      transport: server.transport,
      capabilityPrefix: server.capability_prefix ?? server.id,
      timeoutMs: server.timeout_ms,
      command: server.command,
      args: [...server.args],
      url: server.url,
      env: { ...server.env },
    };
  }

  private async connectTarget(target: McpServerConnectionTarget): Promise<void> {
    const connection = new McpServerConnection(target, {
      onCapabilitiesChanged: () => this.trackConnection(this.refreshTarget(target.id)),
      onClosed: () => this.handleConnectionClosed(target.id),
      onError: (error) => logger.warn('MCP server 连接异常', {
        server_id: target.id,
        error: summarizeError(error),
      }),
      onStderr: (message) => logger.debug('MCP server stderr', {
        server_id: target.id,
        message,
      }),
    });
    this._connections.set(target.id, connection);

    try {
      const snapshot = await connection.connect();
      if (this._connections.get(target.id) !== connection) {
        await connection.close();
        return;
      }
      this.registerSnapshot(target, connection, snapshot);
      this.setStatus(target, 'ready');
      logger.info('MCP server 已连接并完成能力枚举', {
        server_id: target.id,
        skill_id: this.toSkillId(target),
        tool_count: snapshot.tools.length,
        resource_count: snapshot.resources.length,
        prompt_count: snapshot.prompts.length,
      });
    } catch (error) {
      if (this._connections.get(target.id) === connection) {
        this._connections.delete(target.id);
        this.setStatus(target, 'unavailable', summarizeError(error));
      }
      await connection.close().catch(() => undefined);
      logger.warn('MCP server 未就绪，已保持降级', {
        server_id: target.id,
        transport: target.transport,
        error: summarizeError(error),
      });
    }
  }

  private async refreshTarget(id: string): Promise<void> {
    const target = this._connectionTargets.get(id);
    const connection = this._connections.get(id);
    if (!target || !connection || !this._registrationTarget) {
      return;
    }

    try {
      const snapshot = await connection.describeCapabilities();
      this.registerSnapshot(target, connection, snapshot);
      this.setStatus(target, 'ready');
      logger.info('MCP server 能力目录已刷新', {
        server_id: id,
        tool_count: snapshot.tools.length,
        resource_count: snapshot.resources.length,
        prompt_count: snapshot.prompts.length,
      });
    } catch (error) {
      this.handleConnectionFailure(target, summarizeError(error));
    }
  }

  private handleConnectionClosed(id: string): void {
    const target = this._connectionTargets.get(id);
    if (!target) {
      return;
    }
    this.handleConnectionFailure(target, '远端连接已关闭');
  }

  private handleConnectionFailure(target: McpServerConnectionTarget, error: string): void {
    this._connections.delete(target.id);
    const skillId = this.toSkillId(target);
    this._registrationTarget?.unregisterSkill(skillId);
    this._registeredSkillIds.delete(skillId);
    this._capabilityStats.delete(target.id);
    this.setStatus(target, 'unavailable', error);
  }

  private registerSnapshot(
    target: McpServerConnectionTarget,
    connection: McpServerConnection,
    snapshot: McpCapabilitySnapshot,
  ): void {
    const registrationTarget = this._registrationTarget;
    if (!registrationTarget) {
      return;
    }

    const skillId = this.toSkillId(target);
    this._capabilityStats.set(target.id, {
      displayName: snapshot.serverName ?? target.id,
      skillCount: 1,
      toolCount: snapshot.tools.length,
      resourceCount: snapshot.resources.length,
      promptCount: snapshot.prompts.length,
      updatedAt: new Date().toISOString(),
    });
    registrationTarget.registerSkill({
      id: skillId,
      name: snapshot.serverName ?? target.id,
      description: `来自 MCP Server ${target.id} 的外部能力。`,
      provider: {
        kind: 'mcp_server',
        id: target.id,
      },
      tools: snapshot.tools.map((tool) => this.toSkillTool(connection, tool)),
      resources: snapshot.resources.map((resource) => ({
        id: resource.id,
        description: resource.description,
        parameters: resource.parameters,
        read: (args) => connection.readResource(resource, args),
      })),
      prompts: snapshot.prompts.map((prompt) => ({
        id: prompt.id,
        description: prompt.description,
        template: prompt.description,
        parameters: prompt.parameters,
        render: (args) => connection.getPrompt(prompt.id, args),
      })),
      policy: {
        riskLevel: 'low',
        confirmationRequired: false,
        sideEffects: [],
        audit: true,
      },
      metadata: {
        runtime_status: 'ready',
        implementation: 'mcp_server',
        server_id: target.id,
        transport: target.transport,
        capability_prefix: target.capabilityPrefix,
        server_version: snapshot.serverVersion,
      },
    });
    this._registeredSkillIds.add(skillId);
  }

  private toSkillTool(connection: McpServerConnection, tool: McpToolDefinition) {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      handler: (args: unknown) => connection.callTool(tool.name, args),
      policy: policyForTool(tool),
    };
  }

  private toSkillId(target: McpServerConnectionTarget): string {
    return `mcp.${target.capabilityPrefix}`;
  }

  private setStatus(
    target: McpServerConnectionTarget,
    state: McpServerConnectionState,
    error?: string,
  ): void {
    const status = {
      id: target.id,
      transport: target.transport,
      state,
      skillId: this.toSkillId(target),
      error,
    };
    this._statuses.set(target.id, status);
    this._registrationTarget?.upsertProviderRuntime?.(this.toProviderRuntimeSnapshot(target, status));
    this.syncRuntimeReadiness();
  }

  private trackConnection(task: Promise<void>): void {
    this._pendingConnections.add(task);
    void task.finally(() => this._pendingConnections.delete(task));
  }

  private syncRuntimeReadiness(): void {
    RuntimeReadinessCatalogStore.instance.replaceModuleSnapshots('application', this.getReadinessSnapshots());
  }

  private toProviderRuntimeSnapshot(
    target: McpServerConnectionTarget,
    status: McpServerConnectionStatus,
  ): SkillProviderRuntimeSnapshot {
    const capability = this._capabilityStats.get(target.id);
    const state = status.state === 'ready'
      ? 'ready'
      : status.state === 'connecting'
        ? 'connecting'
        : status.state === 'stopped'
          ? 'stopped'
          : 'unavailable';
    return {
      provider: {
        kind: 'mcp_server',
        id: target.id,
      },
      display_name: capability?.displayName ?? target.id,
      state,
      summary: state === 'ready'
        ? 'MCP provider 已连接并发布能力。'
        : state === 'connecting'
          ? 'MCP provider 正在建立连接。'
          : state === 'stopped'
            ? 'MCP provider 已停止。'
            : status.error || 'MCP provider 当前不可用。',
      skill_count: capability?.skillCount ?? 0,
      tool_count: capability?.toolCount ?? 0,
      resource_count: capability?.resourceCount ?? 0,
      prompt_count: capability?.promptCount ?? 0,
      error: status.error,
      recovery_actions: state === 'unavailable'
        ? ['检查 MCP server command/url 与凭据配置。', '确认远端服务可达后刷新能力目录。']
        : [],
      metadata: {
        transport: target.transport,
        capability_prefix: target.capabilityPrefix,
      },
      updated_at: capability?.updatedAt ?? new Date().toISOString(),
    };
  }
}

function policyForTool(tool: McpToolDefinition): SkillPolicy {
  if (tool.destructive || tool.openWorld) {
    return {
      riskLevel: 'high',
      confirmationRequired: true,
      sideEffects: ['external_mcp'],
      audit: true,
    };
  }
  if (tool.readOnly) {
    return {
      riskLevel: 'low',
      confirmationRequired: false,
      sideEffects: [],
      audit: true,
    };
  }
  return {
    riskLevel: 'medium',
    confirmationRequired: true,
    sideEffects: ['external_mcp'],
    audit: true,
  };
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 320);
}
