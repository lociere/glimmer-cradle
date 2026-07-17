import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionManager } from '../../src/host/extension-manager';
import type {
  ActiveExtensionSelection,
  IExtensionHostService,
  IExtensionSystemConfig,
} from '../../src/foundation/ports';
import type { DomainEvent } from '../../src/foundation/event-bus/events';
import { RuntimeReadinessCatalogStore } from '../../src/foundation/runtime-readiness-catalog';
import { SkillCatalogAppService } from '../../src/application/services/skill-catalog-app.service';
import { SkillRegistry } from '../../src/application/skill-plane/skill-registry';
import {
  createDeclaredExtensionSkill,
  createExtensionSkillFromSubAgent,
} from '../../src/application/skill-plane/providers/extension/extension-skill-provider';

type Disposable = { dispose(): void | Promise<void> };
type ExtensionCommandHandler = (...args: unknown[]) => Promise<unknown> | unknown;
type PermissionName = 'AGENT_REGISTER' | 'COMMAND_REGISTER' | 'EVIDENCE_PROPOSAL_WRITE';

const tempRoots: string[] = [];
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  if (originalDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = originalDataRoot;
  RuntimeReadinessCatalogStore.instance.clear();
});

describe('ExtensionManager', () => {
  it('发布产品从部署数据根发现扩展，不写入只读应用根', async () => {
    const fixture = await createExtensionFixture('test.deployment-data-root', {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.0.0',
    });
    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-extension-app-root-'));
    tempRoots.push(appRoot);
    process.env.GLIMMER_CRADLE_DATA_ROOT = path.join(fixture.root, 'data');
    const catalog = new SkillCatalogAppService(SkillRegistry.instance);
    const host = new FakeExtensionHost(appRoot, catalog, [{ id: fixture.extensionId, version: '1.0.0' }]);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      expect(manager.getRuntimeProjection(fixture.extensionId)?.version).toBe('1.0.0');
      await expect(fs.access(path.join(appRoot, 'data'))).rejects.toThrow();
    } finally {
      await manager.shutdown();
    }
  });

  it('按 active.yaml 精确选择已安装扩展版本', async () => {
    const fixture = await createExtensionFixture('test.versioned', {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.0.0',
    });
    await installExtensionVersion(fixture.root, fixture.extensionId, {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '2.0.0',
    });
    const catalog = new SkillCatalogAppService(SkillRegistry.instance);
    const host = new FakeExtensionHost(fixture.root, catalog, [{ id: fixture.extensionId, version: '1.0.0' }]);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      expect(manager.getRuntimeProjection(fixture.extensionId)?.version).toBe('1.0.0');
      expect(manager.listInstallationProjections()).toEqual([expect.objectContaining({
        extension_id: fixture.extensionId,
        installed_versions: ['2.0.0', '1.0.0'],
        active_version: '1.0.0',
      })]);
      await manager.activateExtension(fixture.extensionId, '2.0.0');
      expect(manager.getRuntimeProjection(fixture.extensionId)?.version).toBe('2.0.0');
      expect(manager.listInstallationProjections()[0]?.active_version).toBe('2.0.0');
    } finally {
      await manager.shutdown();
    }
  });

  it('未激活扩展只投影最新已安装版本，不会自动启动', async () => {
    const fixture = await createExtensionFixture('test.catalog-only', {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.2.0',
    });
    await installExtensionVersion(fixture.root, fixture.extensionId, {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.10.0',
    });
    const catalog = new SkillCatalogAppService(SkillRegistry.instance);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      expect(manager.getRuntimeProjection(fixture.extensionId)).toMatchObject({
        version: '1.10.0',
        lifecycle: 'discovered',
      });
    } finally {
      await manager.shutdown();
    }
  });

  it('按 SemVer 规则让正式版本优先于预发布版本', async () => {
    const fixture = await createExtensionFixture('test.semver-order', {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.0.0-beta.2',
    });
    await installExtensionVersion(fixture.root, fixture.extensionId, {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.0.0',
    });
    const manager = new ExtensionManager(new FakeExtensionHost(
      fixture.root,
      new SkillCatalogAppService(SkillRegistry.instance),
    ));

    try {
      await manager.init();
      expect(manager.getRuntimeProjection(fixture.extensionId)?.version).toBe('1.0.0');
      expect(manager.listInstallationProjections()[0]?.installed_versions).toEqual(['1.0.0', '1.0.0-beta.2']);
    } finally {
      await manager.shutdown();
    }
  });

  it('使用标准 SemVer range 校验 Node Engine', async () => {
    const fixture = await createExtensionFixture('test.node-range', {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.0.0',
      nodeEngine: '>=99.0.0 <100.0.0',
    });
    const manager = new ExtensionManager(new FakeExtensionHost(
      fixture.root,
      new SkillCatalogAppService(SkillRegistry.instance),
      [{ id: fixture.extensionId, version: '1.0.0' }],
    ));

    try {
      await manager.init();
      await expect(manager.loadExtension(fixture.extensionId)).rejects.toThrow('要求 Node.js >=99.0.0 <100.0.0');
    } finally {
      await manager.shutdown();
    }
  });

  it('激活配置引用未安装版本时拒绝初始化', async () => {
    const fixture = await createExtensionFixture('test.missing-version', {
      permissions: [],
      entrySource: 'module.exports = { onActivate() {} };',
      version: '1.0.0',
    });
    const catalog = new SkillCatalogAppService(SkillRegistry.instance);
    const host = new FakeExtensionHost(fixture.root, catalog, [{ id: fixture.extensionId, version: '2.0.0' }]);
    const manager = new ExtensionManager(host);

    await expect(manager.init()).rejects.toThrow(`激活扩展未安装: ${fixture.extensionId}@2.0.0`);
  });

  it('拒绝旧的 extension/package 兼容布局', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-extension-manager-'));
    tempRoots.push(root);
    const extensionId = 'test.legacy-package';
    const legacyDir = path.join(root, 'data', 'packages', 'extensions', extensionId, 'package');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'extension-manifest.yaml'), [
      `id: ${extensionId}`,
      `name: ${extensionId}`,
      'version: 1.0.0',
      'main: index.cjs',
      'minAppVersion: 0.1.0',
    ].join('\n'), 'utf-8');
    const catalog = new SkillCatalogAppService(SkillRegistry.instance);
    const host = new FakeExtensionHost(root, catalog, [{ id: extensionId, version: '1.0.0' }]);
    const manager = new ExtensionManager(host);

    await expect(manager.init()).rejects.toThrow(`激活扩展未安装: ${extensionId}@1.0.0`);
  });

  it('激活缺权限失败时撤销声明式 skill catalog，并发布错误事件', async () => {
    const fixture = await createExtensionFixture('test.no-agent-permission', {
      permissions: [],
      entrySource: `
        module.exports = {
          onActivate(ctx) {
            ctx.ports.agents.registerSubAgent({
              id: 'runtime',
              name: 'runtime skill',
              description: 'should not register',
              audience: 'character',
              tools: []
            });
          }
        };
      `,
    });
    const registry = SkillRegistry.instance;
    const catalog = new SkillCatalogAppService(registry);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      await manager.loadExtension(fixture.extensionId);
      expect(registry.findById(`${fixture.skillPrefix}:declared`)).toBeDefined();

      await expect(manager.startExtension(fixture.extensionId)).rejects.toThrow('缺少权限 AGENT_REGISTER');

      expect(registry.findById(`${fixture.skillPrefix}:declared`)).toBeUndefined();
      expect(registry.findById(`${fixture.skillPrefix}:runtime`)).toBeUndefined();
      expect(host.events.map((event) => event.event_type)).toContain('ExtensionErrorEvent');
    } finally {
      await manager.shutdown();
      catalog.unregisterSkill(`${fixture.skillPrefix}:declared`);
      catalog.unregisterSkill(`${fixture.skillPrefix}:runtime`);
    }
  });

  it('停用扩展时释放声明式目录和运行时 skill，重启时重新注册', async () => {
    const fixture = await createExtensionFixture('test.restartable-agent', {
      permissions: ['AGENT_REGISTER'],
      entrySource: `
        module.exports = {
          onActivate(ctx) {
            ctx.ports.agents.registerSubAgent({
              id: 'runtime',
              name: 'runtime skill',
              description: 'registered at activation',
              audience: 'character',
              tools: [{
                name: 'echo',
                description: 'echo input',
                audience: 'character',
                parameters: { type: 'object' },
                handler: (args) => args
              }]
            });
          }
        };
      `,
    });
    const registry = SkillRegistry.instance;
    const catalog = new SkillCatalogAppService(registry);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      await manager.loadExtension(fixture.extensionId);
      await manager.startExtension(fixture.extensionId);

      expect(registry.findById(`${fixture.skillPrefix}:declared`)).toBeDefined();
      expect(registry.findById(`${fixture.skillPrefix}:runtime`)).toBeDefined();

      await manager.stopExtension(fixture.extensionId);
      expect(registry.findById(`${fixture.skillPrefix}:declared`)).toBeUndefined();
      expect(registry.findById(`${fixture.skillPrefix}:runtime`)).toBeUndefined();

      await manager.startExtension(fixture.extensionId);
      expect(registry.findById(`${fixture.skillPrefix}:declared`)).toBeDefined();
      expect(registry.findById(`${fixture.skillPrefix}:runtime`)).toBeDefined();
    } finally {
      await manager.shutdown();
      catalog.unregisterSkill(`${fixture.skillPrefix}:declared`);
      catalog.unregisterSkill(`${fixture.skillPrefix}:runtime`);
    }
  });

  it('只允许桌面执行 manifest 声明的运行中扩展命令', async () => {
    const fixture = await createExtensionFixture('test.public-command', {
      permissions: ['COMMAND_REGISTER'],
      commands: [
        {
          command: 'test.public-command.public',
          title: 'Public command',
        },
      ],
      entrySource: `
        module.exports = {
          onActivate(ctx) {
            ctx.ports.commands.registerCommand('test.public-command.public', () => 'public-result');
            ctx.ports.commands.registerCommand('test.public-command.private', () => 'private-result');
          }
        };
      `,
    });
    const registry = SkillRegistry.instance;
    const catalog = new SkillCatalogAppService(registry);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      await manager.loadExtension(fixture.extensionId);
      await manager.startExtension(fixture.extensionId);

      await expect(manager.executeCommand('test.public-command.public')).resolves.toBe('public-result');
      await expect(manager.executeCommand('test.public-command.private')).rejects.toThrow('扩展命令未在 glimmer.command 中声明');

      await manager.stopExtension(fixture.extensionId);
      await expect(manager.executeCommand('test.public-command.public')).rejects.toThrow('所属扩展未运行');
    } finally {
      await manager.shutdown();
      catalog.unregisterSkill(`${fixture.skillPrefix}:declared`);
    }
  });

  it('evidenceProposal port 需要权限并转发到 Host service', async () => {
    const fixture = await createExtensionFixture('test.memory-proposal', {
      permissions: ['EVIDENCE_PROPOSAL_WRITE'],
      entrySource: `
        module.exports = {
          async onActivate(ctx) {
            await ctx.ports.evidenceProposal.submit({
              address: {
                provider_id: 'test.memory-proposal',
                provider_account_id: 'bot-account',
                space_kind: 'group',
                external_space_key: '42',
                actor_endpoint_key: 'alice',
                visibility: 'shared'
              },
              sourceEventId: 'message-42',
              schemaRef: 'test://group-summary/v1',
              actorName: 'Alice',
              content: 'Alice 说今晚九点开会',
              summary: '群聊里提到今晚九点开会',
              confidence: 0.8,
              tags: ['group-summary']
            });
          }
        };
      `,
    });
    const registry = SkillRegistry.instance;
    const catalog = new SkillCatalogAppService(registry);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      await manager.loadExtension(fixture.extensionId);
      await manager.startExtension(fixture.extensionId);

      expect(host.evidenceProposals).toEqual([{
        extensionId: fixture.extensionId,
        proposal: expect.objectContaining({
          address: expect.objectContaining({ external_space_key: '42' }),
          content: 'Alice 说今晚九点开会',
          summary: '群聊里提到今晚九点开会',
        }),
      }]);
    } finally {
      await manager.shutdown();
      catalog.unregisterSkill(`${fixture.skillPrefix}:declared`);
    }
  });

  it('evidenceProposal port 缺权限时拒绝提交', async () => {
    const fixture = await createExtensionFixture('test.memory-proposal-denied', {
      permissions: [],
      entrySource: `
        module.exports = {
          async onActivate(ctx) {
            await ctx.ports.evidenceProposal.submit({
              address: {
                provider_id: 'test.memory-proposal-denied',
                provider_account_id: 'bot-account',
                space_kind: 'group',
                external_space_key: '42',
                visibility: 'shared'
              },
              sourceEventId: 'message-denied',
              schemaRef: 'test://group-summary/v1',
              content: 'should be denied'
            });
          }
        };
      `,
    });
    const registry = SkillRegistry.instance;
    const catalog = new SkillCatalogAppService(registry);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      await manager.loadExtension(fixture.extensionId);

      await expect(manager.startExtension(fixture.extensionId)).rejects.toThrow('缺少权限 EVIDENCE_PROPOSAL_WRITE');
      expect(host.evidenceProposals).toEqual([]);
    } finally {
      await manager.shutdown();
      catalog.unregisterSkill(`${fixture.skillPrefix}:declared`);
    }
  });

  it('扩展生命周期变化会刷新 runtime readiness catalog', async () => {
    const fixture = await createExtensionFixture('test.runtime-readiness-sync', {
      permissions: [],
      entrySource: `
        module.exports = {
          onActivate() {}
        };
      `,
    });
    const registry = SkillRegistry.instance;
    const catalog = new SkillCatalogAppService(registry);
    const host = new FakeExtensionHost(fixture.root, catalog);
    const manager = new ExtensionManager(host);

    try {
      await manager.init();
      await manager.loadExtension(fixture.extensionId);
      expect(RuntimeReadinessCatalogStore.instance.getCatalog().runtimes.find(
        (snapshot) => snapshot.runtime_id === `extension.${fixture.extensionId}`,
      )?.state).toBe('starting');

      await manager.startExtension(fixture.extensionId);
      expect(RuntimeReadinessCatalogStore.instance.getCatalog().runtimes.find(
        (snapshot) => snapshot.runtime_id === `extension.${fixture.extensionId}`,
      )?.state).toBe('ready');

      await manager.stopExtension(fixture.extensionId);
      expect(RuntimeReadinessCatalogStore.instance.getCatalog().runtimes.find(
        (snapshot) => snapshot.runtime_id === `extension.${fixture.extensionId}`,
      )?.state).toBe('stopped');
    } finally {
      await manager.shutdown();
      catalog.unregisterSkill(`${fixture.skillPrefix}:declared`);
    }
  });
});

describe('Extension skill provider audience filtering', () => {
  it('createExtensionSkillFromSubAgent 只接受显式 character profile 与 character tools', () => {
    expect(createExtensionSkillFromSubAgent('demo-extension', {
      id: 'runtime',
      name: 'runtime skill',
      description: 'not exposed by default',
      tools: [{
        name: 'openPanel',
        description: '管理动作',
        parameters: {},
        handler: () => 'opened',
      }],
    } as any)).toBeNull();

    const skill = createExtensionSkillFromSubAgent('demo-extension', {
      id: 'runtime',
      name: 'runtime skill',
      description: 'mixed tools',
      audience: 'character',
      tools: [
        {
          name: 'character.lookup',
          description: '角色可用',
          audience: 'character',
          parameters: {},
          handler: () => 'ok',
        },
        {
          name: 'user.openPanel',
          description: '用户管理',
          audience: 'user',
          parameters: {},
          handler: () => 'opened',
        },
      ],
    } as any);

    expect(skill?.tools.map((tool) => tool.name)).toEqual(['character.lookup']);
  });

  it('createDeclaredExtensionSkill 过滤非 character tool/resource/prompt', () => {
    const skill = createDeclaredExtensionSkill('demo-extension', {
      id: 'declared',
      name: 'declared skill',
      description: 'mixed contribution',
      audience: 'character',
      tools: [
        { name: 'character.lookup', description: '角色工具', audience: 'character', parameters: {} },
        { name: 'user.openPanel', description: '管理工具', audience: 'user', parameters: {} },
      ],
      resources: [
        { id: 'character.resource', description: '角色资源', audience: 'character' },
        { id: 'host.resource', description: 'Host 资源', audience: 'host' },
      ],
      prompts: [
        { id: 'character.prompt', description: '角色 prompt', audience: 'character', template: 'hello' },
        { id: 'adapter.prompt', description: 'Adapter prompt', audience: 'adapter', template: 'bridge' },
      ],
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
    } as any);

    expect(skill?.tools.map((tool) => tool.name)).toEqual(['character.lookup']);
    expect(skill?.resources?.map((resource) => resource.id)).toEqual(['character.resource']);
    expect(skill?.prompts?.map((prompt) => prompt.id)).toEqual(['character.prompt']);

    expect(createDeclaredExtensionSkill('demo-extension', {
      id: 'management-only',
      name: 'management only',
      description: 'no character surface',
      audience: 'character',
      tools: [{ name: 'user.openPanel', description: '管理工具', audience: 'user', parameters: {} }],
      resources: [{ id: 'host.resource', description: 'Host 资源', audience: 'host' }],
      prompts: [{ id: 'adapter.prompt', description: 'Adapter prompt', audience: 'adapter', template: 'bridge' }],
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
    } as any)).toBeNull();
  });
});

async function createExtensionFixture(
  extensionId: string,
  options: ExtensionFixtureOptions,
): Promise<{
  root: string;
  extensionId: string;
  skillPrefix: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-extension-manager-'));
  tempRoots.push(root);
  await installExtensionVersion(root, extensionId, options);

  return {
    root,
    extensionId,
    skillPrefix: `extension:${extensionId}`,
  };
}

interface ExtensionFixtureOptions {
  permissions: PermissionName[];
  entrySource: string;
  commands?: Array<{ command: string; title: string; category?: string }>;
  version?: string;
  nodeEngine?: string;
}

async function installExtensionVersion(
  root: string,
  extensionId: string,
  options: ExtensionFixtureOptions,
): Promise<void> {
  const version = options.version ?? '0.1.0';
  const extensionDir = path.join(root, 'data', 'packages', 'extensions', extensionId, version);
  await fs.mkdir(extensionDir, { recursive: true });
  await fs.writeFile(path.join(extensionDir, 'index.cjs'), options.entrySource, 'utf-8');
  await fs.writeFile(path.join(extensionDir, 'extension-manifest.yaml'), [
    `id: ${extensionId}`,
    `name: ${extensionId}`,
    `version: ${version}`,
    'publisher: test',
    'license: GPL-3.0-only',
    'repository: https://example.com/test-extension',
    'main: index.cjs',
    'minAppVersion: 0.1.0',
    'engines:',
    '  glimmerCradle: 0.1.0',
    ...(options.nodeEngine ? [`  node: ${JSON.stringify(options.nodeEngine)}`] : []),
    'activationEvents:',
    '  - onStartup',
    'requires:',
    '  - agents',
    ...(options.permissions.length > 0
      ? ['permissions:', ...options.permissions.map((permission) => `  - ${permission}`)]
      : ['permissions: []']),
    'contributes:',
    ...(options.commands?.length
      ? [
          '  glimmer.command:',
          ...options.commands.flatMap((command) => [
            `    - command: ${command.command}`,
            `      title: ${command.title}`,
            ...(command.category ? [`      category: ${command.category}`] : []),
          ]),
        ]
      : []),
    '  glimmer.skill:',
    '    - id: declared',
    '      name: declared skill',
    '      description: declared catalog entry',
    '      tools:',
    '        - name: declared.echo',
    '          description: declared echo',
    '          parameters:',
    '            type: object',
  ].join('\n'), 'utf-8');
}

class FakeExtensionHost implements IExtensionHostService {
  public readonly events: DomainEvent[] = [];
  public readonly evidenceProposals: Array<{ extensionId: string; proposal: any }> = [];
  private readonly _commands = new Map<string, ExtensionCommandHandler>();
  private readonly _projections = new Map<string, any>();

  public constructor(
    private readonly _repoRoot: string,
    private readonly _catalog: SkillCatalogAppService,
    private readonly _activeExtensions: ActiveExtensionSelection[] = [],
  ) {}

  public getConfig(): IExtensionSystemConfig {
    return {
      identity: {
        app_version: '0.1.0',
      },
      extensions: {
        extension_root_dir: 'data/packages/extensions',
        sandbox: {
          timeout_ms: 3_000,
        },
      },
    };
  }

  public getRepoRoot(): string {
    return this._repoRoot;
  }

  public async loadActiveExtensions(): Promise<ActiveExtensionSelection[]> {
    return this._activeExtensions;
  }

  public async saveActiveExtensions(selections: ActiveExtensionSelection[]): Promise<void> {
    this._activeExtensions.splice(0, this._activeExtensions.length, ...selections);
  }

  public createLogger(_module: string) {
    return {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
  }

  public createStorage(_extensionId: string) {
    const values = new Map<string, unknown>();
    return {
      get: async (key) => values.get(key),
      set: async (key, value) => {
        values.set(key, value);
      },
      delete: async (key) => {
        values.delete(key);
      },
    };
  }

  public async submitEvidenceProposal(extensionId: string, proposal: any): Promise<void> {
    this.evidenceProposals.push({ extensionId, proposal });
  }

  public registerCommand(
    _extensionId: string,
    commandId: string,
    handler: ExtensionCommandHandler,
    _metadata?: unknown,
  ): Disposable {
    this._commands.set(commandId, handler);
    return {
      dispose: () => {
        this._commands.delete(commandId);
      },
    };
  }

  public async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    const handler = this._commands.get(commandId);
    if (!handler) {
      throw new Error(`命令不存在: ${commandId}`);
    }
    return handler(...args);
  }

  public async listCommands() {
    return Array.from(this._commands.keys()).map((command) => ({
      id: command,
      command,
      title: command,
      audience: 'user',
      permissions: [],
      dependsOn: [],
      metadata: {},
      actionKind: 'command',
      preconditions: [],
    }));
  }

  public subscribeEvent(_eventName: string, _handler: (event: unknown) => Promise<void>): Disposable {
    return {
      dispose: () => undefined,
    };
  }

  public publishExtensionEvent(_eventType: string, _eventId: string, _payload: unknown): void {}

  public publishDomainEvent(event: DomainEvent): void {
    this.events.push(event);
  }

  public async injectPerception(): Promise<void> {}

  public requestSceneAttentionLease(): Disposable {
    return {
      dispose: () => undefined,
    };
  }

  public isSceneFocused(): boolean {
    return false;
  }

  public registerSourcePolicies(): void {}

  public registerAgent(extensionId: string, profile: any): Disposable {
    const skill = createExtensionSkillFromSubAgent(extensionId, profile);
    if (!skill) {
      return { dispose: () => undefined };
    }
    this._catalog.registerSkill(skill);
    return {
      dispose: () => this._catalog.unregisterSkill(skill.id),
    };
  }

  public registerDeclaredSkills(
    extensionId: string,
    skills: any[],
  ): Disposable[] {
    return skills.map((contribution) => {
      const skill = createDeclaredExtensionSkill(extensionId, contribution);
      if (!skill) {
        return { dispose: () => undefined };
      }
      this._catalog.registerSkill(skill);
      return {
        dispose: () => this._catalog.unregisterSkill(skill.id),
      };
    });
  }

  public registerExtensionRuntimeManifest(manifest: any): any {
    const projection = {
      schema: 'glimmer-cradle.extension.runtime-projection',
      extension_id: manifest.id,
      display_name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      permissions: manifest.permissions ?? [],
      tags: manifest.tags ?? [],
      lifecycle: 'loaded',
      summary: '扩展已加载，等待启动。',
      contribution_points: [],
      capability_graph: {
        nodes: [],
        edges: [],
      },
      actions: [],
      diagnostics: {
        summary: '',
        entries: [],
        log_locations: [],
        recovery_actions: [],
      },
      updated_at: new Date().toISOString(),
    };
    this._projections.set(manifest.id, projection);
    return projection;
  }

  public updateExtensionRuntimeLifecycle(extensionId: string, lifecycle: any, summary?: string, error?: string): any {
    const current = this._projections.get(extensionId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      lifecycle,
      summary: summary ?? current.summary,
      diagnostics: {
        ...current.diagnostics,
        summary: error ?? current.diagnostics.summary,
        last_error: error,
      },
      updated_at: new Date().toISOString(),
    };
    this._projections.set(extensionId, next);
    return next;
  }

  public mergeExtensionCapabilityGraph(extensionId: string, report: any): any {
    const current = this._projections.get(extensionId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      capability_graph: {
        nodes: report.nodes ?? current.capability_graph.nodes,
        edges: report.edges ?? current.capability_graph.edges,
      },
      actions: report.actions ?? current.actions,
      updated_at: new Date().toISOString(),
    };
    this._projections.set(extensionId, next);
    return next;
  }

  public updateExtensionDiagnostics(extensionId: string, diagnostics: any): any {
    const current = this._projections.get(extensionId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      diagnostics,
      updated_at: new Date().toISOString(),
    };
    this._projections.set(extensionId, next);
    return next;
  }

  public unregisterExtensionRuntime(extensionId: string): void {
    this._projections.delete(extensionId);
  }

  public listExtensionRuntimeProjections(): any[] {
    return Array.from(this._projections.values());
  }

  public getExtensionRuntimeProjection(extensionId: string): any {
    return this._projections.get(extensionId);
  }
}
