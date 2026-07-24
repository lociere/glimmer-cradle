import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';

export interface McpServerConnectionTarget {
  id: string;
  transport: 'stdio' | 'http' | 'websocket';
  capabilityPrefix: string;
  timeoutMs: number;
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  readOnly: boolean;
  destructive: boolean;
  openWorld: boolean;
}

export interface McpResourceDefinition {
  id: string;
  description: string;
  parameters?: unknown;
  uri?: string;
  uriTemplate?: string;
}

export interface McpPromptDefinition {
  id: string;
  description: string;
  parameters: unknown;
}

export interface McpCapabilitySnapshot {
  serverName?: string;
  serverVersion?: string;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
}

export interface McpServerConnectionCallbacks {
  onCapabilitiesChanged?: () => void;
  onClosed?: () => void;
  onError?: (error: Error) => void;
  onStderr?: (message: string) => void;
}

type McpTransport = StdioClientTransport | StreamableHTTPClientTransport | WebSocketClientTransport;

/**
 * 一个连接只拥有一个远端 MCP Server；Provider 负责把其能力投影进 Skill Catalog。
 */
export class McpServerConnection {
  private readonly _client: Client;
  private _transport: McpTransport | null = null;
  private _closedByOwner = false;

  public constructor(
    public readonly target: McpServerConnectionTarget,
    private readonly _callbacks: McpServerConnectionCallbacks = {},
  ) {
    this._client = new Client(
      { name: 'glimmer-cradle-kernel', version: '0.1.8' },
      {
        capabilities: {},
        listChanged: {
          tools: { onChanged: () => this._callbacks.onCapabilitiesChanged?.() },
          resources: { onChanged: () => this._callbacks.onCapabilitiesChanged?.() },
          prompts: { onChanged: () => this._callbacks.onCapabilitiesChanged?.() },
        },
      },
    );
    this._client.onclose = () => {
      if (!this._closedByOwner) {
        this._callbacks.onClosed?.();
      }
    };
    this._client.onerror = (error) => this._callbacks.onError?.(error);
  }

  public async connect(): Promise<McpCapabilitySnapshot> {
    const transport = this.createTransport();
    this._transport = transport;
    await this.withTimeout(this._client.connect(transport), '初始化 MCP 协议');
    return this.describeCapabilities();
  }

  public async close(): Promise<void> {
    this._closedByOwner = true;
    const transport = this._transport;
    this._transport = null;
    if (transport) {
      await transport.close();
    }
  }

  public async describeCapabilities(): Promise<McpCapabilitySnapshot> {
    const capabilities = this._client.getServerCapabilities();
    const [tools, resources, prompts] = await Promise.all([
      capabilities?.tools ? this.listTools() : Promise.resolve([]),
      capabilities?.resources ? this.listResources() : Promise.resolve([]),
      capabilities?.prompts ? this.listPrompts() : Promise.resolve([]),
    ]);
    const server = this._client.getServerVersion();

    return {
      serverName: server?.name,
      serverVersion: server?.version,
      tools,
      resources,
      prompts,
    };
  }

  public async callTool(name: string, args: unknown): Promise<unknown> {
    return this.withTimeout(
      this._client.callTool({ name, arguments: toRecord(args, `MCP tool ${name} 的参数`) }),
      `调用 MCP tool ${name}`,
    );
  }

  public async readResource(resource: McpResourceDefinition, args?: unknown): Promise<unknown> {
    const uri = resource.uri ?? resolveTemplateUri(resource, args);
    return this.withTimeout(this._client.readResource({ uri }), `读取 MCP resource ${resource.id}`);
  }

  public async getPrompt(name: string, args?: unknown): Promise<unknown> {
    return this.withTimeout(
      this._client.getPrompt({ name, arguments: toPromptArguments(args) }),
      `渲染 MCP prompt ${name}`,
    );
  }

  private createTransport(): McpTransport {
    if (this.target.transport === 'stdio') {
      if (!this.target.command) {
        throw new Error(`MCP server ${this.target.id} 缺少 stdio command`);
      }
      const transport = new StdioClientTransport({
        command: this.target.command,
        args: this.target.args,
        env: { ...getDefaultEnvironment(), ...this.target.env },
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (chunk: Buffer) => {
        const message = String(chunk).trim();
        if (message) {
          this._callbacks.onStderr?.(message.slice(0, 800));
        }
      });
      return transport;
    }

    if (!this.target.url) {
      throw new Error(`MCP server ${this.target.id} 缺少 ${this.target.transport} URL`);
    }

    const url = new URL(this.target.url);
    return this.target.transport === 'http'
      ? new StreamableHTTPClientTransport(url)
      : new WebSocketClientTransport(url);
  }

  private async listTools(): Promise<McpToolDefinition[]> {
    return this.listPages(
      (cursor) => this._client.listTools(cursor ? { cursor } : undefined),
      (page) =>
        page.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.name,
          parameters: tool.inputSchema,
          readOnly: tool.annotations?.readOnlyHint === true,
          destructive: tool.annotations?.destructiveHint === true,
          openWorld: tool.annotations?.openWorldHint === true,
        })),
    );
  }

  private async listResources(): Promise<McpResourceDefinition[]> {
    const staticResources = await this.listPages(
      (cursor) => this._client.listResources(cursor ? { cursor } : undefined),
      (page) =>
        page.resources.map((resource) => ({
          id: resource.uri,
          description: resource.description ?? resource.name,
          uri: resource.uri,
        })),
    );

    const templates = await this.listPages(
      (cursor) => this._client.listResourceTemplates(cursor ? { cursor } : undefined),
      (page) =>
        page.resourceTemplates.map((resource) => ({
          id: resource.uriTemplate,
          description: resource.description ?? resource.name,
          uriTemplate: resource.uriTemplate,
          parameters: {
            type: 'object',
            description: '可传入 variables 对象，或直接提供完整 uri。',
          },
        })),
    ).catch(() => []);

    return [...staticResources, ...templates];
  }

  private async listPrompts(): Promise<McpPromptDefinition[]> {
    return this.listPages(
      (cursor) => this._client.listPrompts(cursor ? { cursor } : undefined),
      (page) =>
        page.prompts.map((prompt) => ({
          id: prompt.name,
          description: prompt.description ?? prompt.name,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(
              (prompt.arguments ?? []).map((argument) => [argument.name, {
                type: 'string',
                description: argument.description,
              }]),
            ),
            required: (prompt.arguments ?? [])
              .filter((argument) => argument.required)
              .map((argument) => argument.name),
          },
        })),
    );
  }

  private async listPages<T extends { nextCursor?: string }, TItem>(
    listPage: (cursor?: string) => Promise<T>,
    itemsFromPage: (page: T) => TItem[],
  ): Promise<TItem[]> {
    const items: TItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.withTimeout(listPage(cursor), '枚举 MCP 能力');
      items.push(...itemsFromPage(page));
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  private async withTimeout<T>(operation: Promise<T>, action: string): Promise<T> {
    if (this.target.timeoutMs <= 0) {
      return operation;
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`MCP server ${this.target.id} ${action}超时（${this.target.timeoutMs}ms）`));
          }, this.target.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

function toRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

function toPromptArguments(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(toRecord(value, 'MCP prompt 的参数')).map(([key, item]) => [key, String(item)]),
  );
}

function resolveTemplateUri(resource: McpResourceDefinition, args: unknown): string {
  const input = toRecord(args, `MCP resource template ${resource.id} 的参数`);
  if (typeof input.uri === 'string' && input.uri) {
    return input.uri;
  }

  const variables = toRecord(input.variables, `MCP resource template ${resource.id} 的 variables`);
  const uriTemplate = resource.uriTemplate;
  if (!uriTemplate) {
    throw new Error(`MCP resource ${resource.id} 没有可读取 URI`);
  }

  return uriTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) {
      throw new Error(`MCP resource template ${resource.id} 缺少变量: ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}
