import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExtensionPermission,
  type ExtensionCommandContribution,
  type ExtensionManifest,
  type ExtensionSkillContribution,
} from '@glimmer-cradle/extension-sdk';
import type { DiagnosticsSnapshot, ExtensionRuntimeProjection } from '../../ports/extension-runtime-projection';
import { ExtensionProcessHost } from '../../adapters/extension-host/extension-process-host';
import type {
  ActiveExtensionSelection,
  Disposable,
  ExtensionAgentRegistration,
  ExtensionAttentionLeaseRequest,
  ExtensionCapabilityGraphReport,
  ExtensionCommandHandler,
  ExtensionCommandMetadata,
  ExtensionEvidenceProposal,
  ExtensionKeyValueStore,
  ExtensionLogger,
  ExtensionPerceptionProposal,
  IExtensionHostService,
  IExtensionSystemConfig,
} from '../../ports';

const repoRoot = path.resolve(__dirname, '../../../../..');
const hostEntry = path.join(repoRoot, 'hosts', 'extension-host', 'src', 'main.ts');

describe('ExtensionProcessHost', () => {
  const temporaryRoots: string[] = [];
  const previousHostEntry = process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY;

  afterEach(async () => {
    if (previousHostEntry === undefined) delete process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY;
    else process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY = previousHostEntry;
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('runs third-party command handlers in the isolated host process and releases them on stop', async () => {
    process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY = hostEntry;
    const root = await mkdtemp(path.join(tmpdir(), 'glimmer-extension-host-'));
    temporaryRoots.push(root);
    const entry = path.join(root, 'extension.js');
    await writeFile(entry, [
      'module.exports = {',
      '  onActivate(ctx) {',
      "    ctx.ports.commands.registerCommand(`${ctx.extensionId}.ping`, async () => ({ pid: process.pid, extensionId: ctx.extensionId, activationProfile: ctx.activationProfile, secret: await ctx.ports.secrets.get('probe') }), { title: 'Ping' });",
      '  }',
      '};',
      '',
    ].join('\n'), 'utf8');
    const service = new FakeExtensionHostService();
    const host = new ExtensionProcessHost(
      service,
      { id: 'demo.extension', permissions: [ExtensionPermission.COMMAND_REGISTER, ExtensionPermission.SECRET_READ_SELF] },
      entry,
      {},
      { probe: 'isolated-secret' },
      'default',
      5000,
    );

    await host.start();
    const result = await service.executeCommand('demo.extension.ping') as { pid: number; extensionId: string; activationProfile: string; secret: string };

    expect(result.extensionId).toBe('demo.extension');
    expect(result.activationProfile).toBe('default');
    expect(result.secret).toBe('isolated-secret');
    expect(result.pid).not.toBe(process.pid);
    expect(service.commands.size).toBe(1);
    expect(service.lifecycleStages).toContain('Extension demo.extension activated.');

    await host.stop();

    expect(service.commands.size).toBe(0);
  });

  it('fails closed when the manifest lacks the permission required by a Host Port', async () => {
    process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY = hostEntry;
    const root = await mkdtemp(path.join(tmpdir(), 'glimmer-extension-host-denied-'));
    temporaryRoots.push(root);
    const entry = path.join(root, 'extension.js');
    await writeFile(entry, [
      'module.exports = {',
      '  onActivate(ctx) {',
      "    ctx.ports.commands.registerCommand(`${ctx.extensionId}.denied`, () => 'nope');",
      '  }',
      '};',
      '',
    ].join('\n'), 'utf8');
    const service = new FakeExtensionHostService();
    const host = new ExtensionProcessHost(
      service,
      { id: 'demo.denied', permissions: [] },
      entry,
      {},
      {},
      'default',
      5000,
    );

    await expect(host.start()).rejects.toThrow(/缺少权限 COMMAND_REGISTER/);
    await host.stop().catch(() => undefined);

    expect(service.commands.size).toBe(0);
  });

  it('denies extension Secret reads without SECRET_READ_SELF', async () => {
    process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY = hostEntry;
    const root = await mkdtemp(path.join(tmpdir(), 'glimmer-extension-host-secret-denied-'));
    temporaryRoots.push(root);
    const entry = path.join(root, 'extension.js');
    await writeFile(entry, [
      'module.exports = {',
      '  onActivate(ctx) {',
      "    ctx.ports.commands.registerCommand(`${ctx.extensionId}.secrets`, () => ctx.ports.secrets.get('probe'));",
      '  }',
      '};',
      '',
    ].join('\n'), 'utf8');
    const service = new FakeExtensionHostService();
    const host = new ExtensionProcessHost(
      service,
      { id: 'demo.secret-denied', permissions: [ExtensionPermission.COMMAND_REGISTER] },
      entry,
      {},
      { probe: 'must-not-cross-boundary' },
      'default',
      5000,
    );

    await host.start();
    await expect(service.executeCommand('demo.secret-denied.secrets')).rejects.toThrow(/缺少权限 SECRET_READ_SELF/);
    await host.stop();
  });

  it('stops the isolated host when a registration disposable hangs', async () => {
    process.env.GLIMMER_CRADLE_EXTENSION_HOST_ENTRY = hostEntry;
    const root = await mkdtemp(path.join(tmpdir(), 'glimmer-extension-host-hung-registration-'));
    temporaryRoots.push(root);
    const entry = path.join(root, 'extension.js');
    await writeFile(entry, [
      'module.exports = {',
      '  onActivate(ctx) {',
      "    ctx.ports.sceneAttention.requestAttentionLease({ channelId: 'demo-channel' });",
      '  }',
      '};',
      '',
    ].join('\n'), 'utf8');
    const service = new FakeExtensionHostService();
    service.attentionLeaseDispose = () => new Promise<void>(() => undefined);
    const host = new ExtensionProcessHost(
      service,
      { id: 'demo.hung-registration', permissions: [] },
      entry,
      {},
      {},
      'default',
      2000,
    );

    await host.start();
    await expect(withTestTimeout(host.stop(), 5000)).resolves.toBeUndefined();

    expect(service.lifecycleStages).toContain('Extension Host demo.hung-registration stopped');
  });
});

class FakeExtensionHostService implements IExtensionHostService {
  public readonly commands = new Map<string, { extensionId: string; handler: ExtensionCommandHandler; metadata?: ExtensionCommandMetadata }>();
  public readonly lifecycleStages: string[] = [];
  public attentionLeaseDispose: () => void | Promise<void> = () => undefined;

  public getApplicationVersion(): string { return '0.1.0'; }
  public getConfig(): IExtensionSystemConfig {
    return { extensions: { extension_root_dir: 'data/packages/extensions', sandbox: { timeout_ms: 5000 } } };
  }
  public getRepoRoot(): string { return repoRoot; }
  public async loadActiveExtensions(): Promise<ActiveExtensionSelection[]> { return []; }
  public async saveActiveExtensions(_selections: ActiveExtensionSelection[]): Promise<void> {}
  public createLogger(_module: string): ExtensionLogger { return noopLogger; }
  public createStorage(_extensionId: string): ExtensionKeyValueStore { return memoryStore; }
  public async submitEvidenceProposal(_extensionId: string, _proposal: ExtensionEvidenceProposal): Promise<void> {}
  public registerCommand(extensionId: string, commandId: string, handler: ExtensionCommandHandler, metadata?: ExtensionCommandMetadata): Disposable {
    this.commands.set(commandId, { extensionId, handler, metadata });
    return { dispose: () => { this.commands.delete(commandId); } };
  }
  public async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`missing command: ${commandId}`);
    return command.handler(...args);
  }
  public async listCommands(): Promise<ExtensionCommandContribution[]> { return []; }
  public subscribeEvent(_eventName: string, _handler: (event: unknown) => Promise<void>): Disposable { return { dispose: () => undefined }; }
  public publishExtensionEvent(_eventType: string, _eventId: string, _payload: unknown): void {}
  public publishDomainEvent(_event: never): void {}
  public async injectPerception(_extensionId: string, _proposal: ExtensionPerceptionProposal): Promise<void> {}
  public requestSceneAttentionLease(_extensionId: string, _request: ExtensionAttentionLeaseRequest): Disposable {
    return { dispose: () => this.attentionLeaseDispose() };
  }
  public async isSceneFocused(_channelId: string): Promise<boolean> { return false; }
  public registerSourcePolicies(_extensionId: string, _policies: Record<string, string>): void {}
  public registerAgent(_extensionId: string, _profile: ExtensionAgentRegistration): Disposable { return { dispose: () => undefined }; }
  public registerDeclaredSkills(_extensionId: string, _skills: ExtensionSkillContribution[]): Disposable[] { return []; }
  public registerExtensionRuntimeManifest(manifest: Pick<ExtensionManifest, 'id' | 'name' | 'version' | 'description' | 'permissions' | 'tags' | 'contributionPoints' | 'contributes'>): ExtensionRuntimeProjection {
    return createProjection(manifest.id);
  }
  public updateExtensionRuntimeLifecycle(_extensionId: string, lifecycle: ExtensionRuntimeProjection['lifecycle'], summary?: string, error?: string): ExtensionRuntimeProjection | undefined {
    this.lifecycleStages.push(error ?? summary ?? lifecycle);
    return createProjection(_extensionId, lifecycle);
  }
  public mergeExtensionCapabilityGraph(_extensionId: string, _report: ExtensionCapabilityGraphReport): ExtensionRuntimeProjection | undefined { return createProjection(_extensionId); }
  public updateExtensionDiagnostics(_extensionId: string, diagnostics: DiagnosticsSnapshot): ExtensionRuntimeProjection | undefined {
    if (diagnostics.summary) this.lifecycleStages.push(diagnostics.summary);
    if (diagnostics.last_error) this.lifecycleStages.push(diagnostics.last_error);
    return createProjection(_extensionId);
  }
  public unregisterExtensionRuntime(_extensionId: string): void {}
  public listExtensionRuntimeProjections(): ExtensionRuntimeProjection[] { return []; }
  public getExtensionRuntimeProjection(_extensionId: string): ExtensionRuntimeProjection | undefined { return createProjection(_extensionId); }
}

function withTestTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`test timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const noopLogger: ExtensionLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const memoryStore: ExtensionKeyValueStore = {
  get: async () => undefined,
  set: async () => undefined,
  delete: async () => undefined,
};

function createProjection(
  extensionId: string,
  lifecycle: ExtensionRuntimeProjection['lifecycle'] = 'loaded',
): ExtensionRuntimeProjection {
  return {
    schema: 'glimmer-cradle.extension.runtime-projection',
    extension_id: extensionId,
    display_name: extensionId,
    version: '1.0.0',
    permissions: [],
    tags: [],
    lifecycle,
    contribution_points: [],
    capability_graph: { nodes: [], edges: [] },
    actions: [],
    diagnostics: { summary: '', entries: [], log_locations: [], recovery_actions: [] },
    updated_at: new Date().toISOString(),
  };
}
