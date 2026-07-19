import fs from 'fs-extra';
import path from 'node:path';
import { gte, rcompare, satisfies, valid, validRange } from 'semver';
import yaml from 'yaml';
import {
  BuiltInContributionPoint,
  ErrorCode,
  EXTENSION_ID_PATTERN,
  EXTENSION_VERSION_PATTERN,
  materializeManifestForActivationProfile,
  getExtensionContributions,
  getManagedResourceContributions,
  resolveExtensionActivationProfile,
  validateExtensionManifest,
  type ExtensionCommandContribution,
  type ExtensionInstallationProjection,
  type ExtensionManifest,
  type ExtensionPermission,
  type ExtensionProductTarget,
  type ExtensionRuntimeProjection,
  type ExtensionSkillContribution,
} from '@glimmer-cradle/protocol';
import type { RuntimeReadinessSnapshot } from '../foundation/runtime-readiness';
import { ExtensionErrorEvent, ExtensionLoadedEvent, ExtensionStartedEvent, ExtensionStoppedEvent } from '../foundation/event-bus/events';
import type { ActiveExtensionSelection, Disposable, IExtensionHostService } from '../foundation/ports';
import { ExtensionException } from '../foundation/exceptions';
import { createTraceContext } from '../foundation/logger/trace-context';
import { RuntimeReadinessCatalogStore } from '../foundation/runtime-readiness-catalog';
import { resolveConfigPath, resolveConfiguredProjectPath } from '../foundation/utils/path-utils';
import { buildExtensionRuntimeReadinessSnapshots } from './extension-runtime-readiness';
import { ExtensionDependencyInstaller } from './extension-dependency-installer';
import {
  ExtensionPackageManager,
  type ExtensionInstallPreview,
  type ExtensionInstallResult,
  type ExtensionInstallSource,
} from '../infrastructure/extension-installation/extension-package-manager';
import { ManagedResourceSupervisor } from './managed-resource-supervisor';
import { ExtensionProcessHost } from './process/extension-process-host';
import { currentExtensionPlatform } from '../application/skill-plane/availability';

type ExtensionManifestRecord = {
  id: string;
  name: string;
  version: string;
  description?: string;
  tags: string[];
  products: ExtensionManifest['products'];
  main: string;
  minAppVersion: string;
  permissions: ExtensionPermission[];
  activationEvents: ExtensionManifest['activationEvents'];
  requires: ExtensionManifest['requires'];
  engines: ExtensionManifest['engines'];
  contributionPoints: ExtensionManifest['contributionPoints'];
  activationProfiles: ExtensionManifest['activationProfiles'];
  contributes: ExtensionManifest['contributes'];
};

interface ExtensionInstance {
  manifest: ExtensionManifestRecord;
  host: ExtensionProcessHost;
  declaredSkillDisposables: Disposable[];
  isRunning: boolean;
}

export class ExtensionManager {
  private static readonly ACTIVATION_PROFILE_FEATURES = new Set(['extensions'] as const);
  private extensionRootDir = resolveConfiguredProjectPath(path.join('data', 'packages', 'extensions'));
  private readonly extensions = new Map<string, ExtensionInstance>();
  private extensionDirectoryIndex = new Map<string, string>();
  private activeExtensions: ActiveExtensionSelection[] = [];
  private extensionTimeoutMs = 5000;
  private isInitialized = false;
  private isShuttingDown = false;
  private packageManager: ExtensionPackageManager | null = null;
  private installedVersionCatalog = new Map<string, Map<string, string>>();
  private readonly logger;

  public constructor(
    private readonly hostService: IExtensionHostService,
    private readonly productId: Exclude<ExtensionProductTarget, 'any'> = 'desktop',
  ) {
    this.logger = hostService.createLogger('extension-manager');
  }

  /** Discover manifests only. Third-party code is never loaded in the Kernel process. */
  public async init(): Promise<void> {
    if (this.isInitialized) return;
    const config = this.hostService.getConfig();
    this.extensionRootDir = resolveConfiguredProjectPath(config.extensions.extension_root_dir, {
      repoRoot: this.hostService.getRepoRoot(),
    });
    this.extensionTimeoutMs = config.extensions.sandbox.timeout_ms;
    await fs.ensureDir(this.extensionRootDir);
    this.packageManager = new ExtensionPackageManager(this.extensionRootDir, this.productId);
    await this.packageManager.initialize();
    this.activeExtensions = await this.hostService.loadActiveExtensions();
    this.extensionDirectoryIndex = await this.discoverExtensionDirectories(this.activeExtensions);

    await Promise.all([...this.extensionDirectoryIndex.entries()].map(async ([extensionId, extensionDir]) => {
      try {
        const manifest = await this.readExtensionManifest(extensionId, extensionDir);
        const effectiveManifest = this.materializeManifestForRuntime(extensionId, manifest);
        this.assertProductCompatibility(extensionId, effectiveManifest);
        this.hostService.registerExtensionRuntimeManifest(effectiveManifest);
        this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'discovered');
      } catch (error) {
        this.logger.warn('扩展发现失败，已跳过', {
          extension_id: extensionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
    this.isInitialized = true;
    this.syncRuntimeReadiness();
    this.logger.info('Extension Host 目录发现完成', {
      discovered: this.extensionDirectoryIndex.size,
      active: this.activeExtensions,
    });
  }

  public async loadExtension(extensionId: string): Promise<void> {
    if (this.isShuttingDown || this.extensions.has(extensionId)) return;
    const extensionDir = this.extensionDirectoryIndex.get(extensionId);
    if (!extensionDir) throw this.validationError(`未找到扩展目录: ${extensionId}`);
    const manifest = this.materializeManifestForRuntime(
      extensionId,
      await this.readExtensionManifest(extensionId, extensionDir),
    );
    this.assertProductCompatibility(extensionId, manifest);
    this.assertEngineCompatibility(extensionId, manifest);
    const entryPath = path.resolve(extensionDir, manifest.main);
    if (!(await fs.pathExists(entryPath))) throw this.validationError(`扩展入口不存在: ${entryPath}`);

    this.hostService.registerExtensionRuntimeManifest(manifest);
    try {
      await this.prepareExternalDependencies(extensionId, manifest);
      if (this.isShuttingDown) return;
      await this.inspectManagedResources(extensionId, manifest);
      if (this.isShuttingDown) return;
      const config = await this.loadExtensionConfig(extensionId);
      if (this.isShuttingDown) return;
      const declaredSkillDisposables = this.registerDeclaredSkillEntries(extensionId, manifest);
      this.extensions.set(extensionId, {
        manifest,
        host: new ExtensionProcessHost(
          this.hostService,
          manifest,
          entryPath,
          config,
          this.extensionTimeoutMs,
        ),
        declaredSkillDisposables,
        isRunning: false,
      });
      this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'loaded');
      this.hostService.publishDomainEvent(new ExtensionLoadedEvent({
        extensionId: manifest.id,
        name: manifest.name,
        version: manifest.version,
      }, createTraceContext()));
    } catch (error) {
      this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'failed', undefined, errorMessage(error));
      this.publishError(extensionId, error);
      throw error;
    } finally {
      this.syncRuntimeReadiness();
    }
  }

  public async startExtension(extensionId: string): Promise<void> {
    if (this.isShuttingDown) return;
    if (!this.extensions.has(extensionId)) await this.loadExtension(extensionId);
    const item = this.extensions.get(extensionId);
    if (!item || item.isRunning) return;
    this.registerDeclaredSkillEntriesIfNeeded(extensionId, item);
    this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'starting');
    try {
      await item.host.start();
      item.isRunning = true;
      await this.inspectManagedResources(extensionId, item.manifest);
      this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'running');
      this.hostService.publishDomainEvent(new ExtensionStartedEvent({
        extensionId: item.manifest.id,
        name: item.manifest.name,
        version: item.manifest.version,
      }, createTraceContext()));
    } catch (error) {
      await item.host.stop().catch(() => undefined);
      await this.disposeDeclaredSkillEntries(item);
      this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'failed', undefined, errorMessage(error));
      this.publishError(extensionId, error);
      throw error;
    } finally {
      this.syncRuntimeReadiness();
    }
  }

  public async startAllExtensions(): Promise<void> {
    await Promise.all(this.activeExtensions.map(async ({ id: extensionId }) => {
      try { await this.startExtension(extensionId); }
      catch (error) {
        this.logger.error('扩展启动失败', { extension_id: extensionId, error: errorMessage(error) });
      }
    }));
  }

  public async activateExtension(extensionId: string, version?: string, profile?: string): Promise<void> {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) throw this.validationError(`无效扩展 ID: ${extensionId}`);
    const previousSelections = [...this.activeExtensions];
    const previousSelection = previousSelections.find((selection) => selection.id === extensionId);
    const selectedVersion = version?.trim()
      || this.getRuntimeProjection(extensionId)?.version
      || '';
    if (!EXTENSION_VERSION_PATTERN.test(selectedVersion)) {
      throw this.validationError(`扩展没有可激活版本: ${extensionId}`);
    }
    const selectedProfile = await this.resolveSelectionProfile(extensionId, selectedVersion, profile);

    const current = this.extensions.get(extensionId);
    if (current && current.manifest.version !== selectedVersion) {
      await this.stopExtension(extensionId);
      this.extensions.delete(extensionId);
    }
    const next = [
      ...this.activeExtensions.filter((selection) => selection.id !== extensionId),
      { id: extensionId, version: selectedVersion, profile: selectedProfile },
    ];
    await this.hostService.saveActiveExtensions(next);
    this.activeExtensions = next;
    await this.refreshInstalledExtensions();
    try {
      await this.startExtension(extensionId);
    } catch (error) {
      const failedItem = this.extensions.get(extensionId);
      if (failedItem?.manifest.version === selectedVersion) {
        await this.disposeDeclaredSkillEntries(failedItem).catch(() => undefined);
        this.extensions.delete(extensionId);
      }
      await this.hostService.saveActiveExtensions(previousSelections);
      this.activeExtensions = previousSelections;
      await this.refreshInstalledExtensions();
      if (previousSelection?.version) {
        try {
          await this.startExtension(extensionId);
        } catch (restartError) {
          this.logger.error('扩展激活失败后恢复旧版本失败', {
            extension_id: extensionId,
            version: previousSelection.version,
            error: errorMessage(restartError),
          });
        }
      }
      throw error;
    }
  }

  public async deactivateExtension(extensionId: string): Promise<void> {
    if (!EXTENSION_ID_PATTERN.test(extensionId)) throw this.validationError(`无效扩展 ID: ${extensionId}`);
    await this.stopExtension(extensionId);
    this.extensions.delete(extensionId);
    const next = this.activeExtensions.filter((selection) => selection.id !== extensionId);
    await this.hostService.saveActiveExtensions(next);
    this.activeExtensions = next;
    await this.refreshInstalledExtensions();
  }

  public async stopExtension(extensionId: string): Promise<void> {
    const item = this.extensions.get(extensionId);
    if (!item) return;
    this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'stopping');
    let stopError: unknown;
    try { await item.host.stop(); }
    catch (error) { stopError = error; }
    await this.disposeDeclaredSkillEntries(item);
    item.isRunning = false;
    this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'stopped');
    this.hostService.publishDomainEvent(new ExtensionStoppedEvent({
      extensionId: item.manifest.id,
      name: item.manifest.name,
      version: item.manifest.version,
    }, createTraceContext()));
    this.syncRuntimeReadiness();
    if (stopError) throw stopError;
  }

  public async stopAllExtensions(): Promise<void> {
    await Promise.all([...this.extensions.keys()].map(async (extensionId) => {
      try { await this.stopExtension(extensionId); }
      catch (error) { this.logger.warn('扩展停止失败，继续回收其他 Host', { extension_id: extensionId, error: errorMessage(error) }); }
    }));
  }

  public async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    const item = this.resolvePublicCommandOwner(commandId);
    if (!item.isRunning) throw this.validationError(`扩展命令所属扩展未运行: ${commandId}`);
    return this.hostService.executeCommand(commandId, ...args);
  }

  public async prepareInstall(source: ExtensionInstallSource): Promise<ExtensionInstallPreview> {
    return this.getPackageManager().prepareInstall(source);
  }

  public async commitInstall(transactionId: string, approvedPermissions: string[]): Promise<ExtensionInstallResult> {
    const result = await this.getPackageManager().commitInstall(transactionId, approvedPermissions);
    await this.refreshInstalledExtensions();
    return result;
  }

  public async cancelInstall(transactionId: string): Promise<void> {
    await this.getPackageManager().cancelInstall(transactionId);
  }

  public async uninstall(extensionId: string, version: string): Promise<void> {
    const active = this.activeExtensions.some((selection) => selection.id === extensionId && selection.version === version);
    await this.getPackageManager().uninstall(extensionId, version, active);
    await this.refreshInstalledExtensions();
  }

  public async refreshInstalledExtensions(): Promise<void> {
    this.activeExtensions = await this.hostService.loadActiveExtensions();
    const nextIndex = await this.discoverExtensionDirectories(this.activeExtensions);
    const removedIds = [...this.extensionDirectoryIndex.keys()].filter((extensionId) => !nextIndex.has(extensionId));
    for (const extensionId of removedIds) this.hostService.unregisterExtensionRuntime(extensionId);
    this.extensionDirectoryIndex = nextIndex;
    await Promise.all([...nextIndex.entries()].map(async ([extensionId, extensionDir]) => {
      const manifest = this.materializeManifestForRuntime(
        extensionId,
        await this.readExtensionManifest(extensionId, extensionDir),
      );
      this.hostService.registerExtensionRuntimeManifest(manifest);
      if (!this.extensions.has(extensionId)) this.hostService.updateExtensionRuntimeLifecycle(extensionId, 'discovered');
    }));
    this.syncRuntimeReadiness();
  }

  public listRuntimeProjections(): ExtensionRuntimeProjection[] { return this.hostService.listExtensionRuntimeProjections(); }
  public listInstallationProjections(): ExtensionInstallationProjection[] {
    const activeById = new Map(this.activeExtensions.map((selection) => [selection.id, selection.version]));
    const updatedAt = new Date().toISOString();
    return [...this.installedVersionCatalog.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([extensionId, versions]) => {
        const [firstVersion, ...remainingVersions] = [...versions.keys()].sort(compareVersionsDescending);
        return {
          extension_id: extensionId,
          installed_versions: [firstVersion!, ...remainingVersions],
          active_version: activeById.get(extensionId),
          active_profile: this.getSelectionFor(extensionId)?.profile,
          updated_at: updatedAt,
        };
      });
  }
  public getRuntimeProjection(extensionId: string): ExtensionRuntimeProjection | undefined { return this.hostService.getExtensionRuntimeProjection(extensionId); }
  public getReadinessSnapshots(): RuntimeReadinessSnapshot[] { return buildExtensionRuntimeReadinessSnapshots(this.listRuntimeProjections()); }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    await this.stopAllExtensions();
    for (const extensionId of this.extensionDirectoryIndex.keys()) this.hostService.unregisterExtensionRuntime(extensionId);
    this.extensions.clear();
    this.extensionDirectoryIndex.clear();
    this.installedVersionCatalog.clear();
    this.activeExtensions = [];
    this.packageManager?.dispose();
    this.packageManager = null;
    this.isInitialized = false;
    this.syncRuntimeReadiness();
  }

  private async discoverExtensionDirectories(
    activeSelections: ActiveExtensionSelection[],
  ): Promise<Map<string, string>> {
    const catalog = await this.scanInstalledExtensionCatalog();
    this.installedVersionCatalog = catalog;

    const activeById = new Map(activeSelections.map((selection) => [selection.id, selection.version]));
    const index = new Map<string, string>();
    for (const [extensionId, versions] of catalog) {
      const selectedVersion = activeById.get(extensionId)
        ?? [...versions.keys()].sort(compareVersionsDescending)[0];
      const selectedDir = versions.get(selectedVersion);
      if (selectedDir) index.set(extensionId, selectedDir);
    }
    for (const selection of activeSelections) {
      if (!catalog.get(selection.id)?.has(selection.version)) {
        throw this.validationError(`激活扩展未安装: ${selection.id}@${selection.version}`);
      }
    }
    return index;
  }

  private async scanInstalledExtensionCatalog(): Promise<Map<string, Map<string, string>>> {
    const catalog = new Map<string, Map<string, string>>();
    const extensionEntries = await fs.readdir(this.extensionRootDir, { withFileTypes: true });
    for (const extensionEntry of extensionEntries) {
      if (!extensionEntry.isDirectory() || !EXTENSION_ID_PATTERN.test(extensionEntry.name)) continue;
      const extensionDir = path.join(this.extensionRootDir, extensionEntry.name);
      const versionEntries = await fs.readdir(extensionDir, { withFileTypes: true });
      const versions = new Map<string, string>();
      for (const versionEntry of versionEntries) {
        if (!versionEntry.isDirectory() || !EXTENSION_VERSION_PATTERN.test(versionEntry.name)) continue;
        const packageDir = path.join(extensionDir, versionEntry.name);
        const manifestPath = path.join(packageDir, 'extension-manifest.yaml');
        if (!(await fs.pathExists(manifestPath))) continue;
        const raw = yaml.parse(await fs.readFile(manifestPath, 'utf8')) as { id?: unknown; version?: unknown };
        const manifestId = typeof raw?.id === 'string' ? raw.id.trim() : '';
        const manifestVersion = typeof raw?.version === 'string' ? raw.version.trim() : '';
        if (manifestId !== extensionEntry.name || manifestVersion !== versionEntry.name) {
          throw this.validationError(
            `扩展安装目录与 manifest 不一致: ${extensionEntry.name}/${versionEntry.name}`,
          );
        }
        versions.set(versionEntry.name, packageDir);
      }
      if (versions.size > 0) catalog.set(extensionEntry.name, versions);
    }
    return catalog;
  }

  private async readExtensionManifest(extensionId: string, extensionDir: string): Promise<ExtensionManifestRecord> {
    const manifestPath = path.join(extensionDir, 'extension-manifest.yaml');
    const parsed = validateExtensionManifest(yaml.parse(await fs.readFile(manifestPath, 'utf8')));
    if (!parsed.ok || !parsed.data) {
      throw this.validationError(`扩展清单格式错误: ${extensionId}; ${parsed.errors.join('; ')}`);
    }
    const manifest = parsed.data;
    if (manifest.id !== extensionId) throw this.validationError(`扩展 ID 不匹配: ${extensionId} != ${manifest.id}`);
    return {
      id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description,
      tags: [...manifest.tags], products: [...manifest.products], main: manifest.main, minAppVersion: manifest.minAppVersion,
      permissions: manifest.permissions, activationEvents: manifest.activationEvents, requires: manifest.requires,
      engines: manifest.engines, contributionPoints: manifest.contributionPoints,
      activationProfiles: manifest.activationProfiles,
      contributes: manifest.contributes,
    };
  }

  private getSelectionFor(extensionId: string): ActiveExtensionSelection | undefined {
    return this.activeExtensions.find((selection) => selection.id === extensionId);
  }

  private materializeManifestForRuntime(
    extensionId: string,
    manifest: ExtensionManifestRecord,
  ): ExtensionManifestRecord {
    const requestedProfile = this.getSelectionFor(extensionId)?.profile;
    const { manifest: effectiveManifest } = materializeManifestForActivationProfile(
      manifest as ExtensionManifest,
      {
        productId: this.productId,
        platform: currentExtensionPlatform(),
        features: ExtensionManager.ACTIVATION_PROFILE_FEATURES,
      },
      requestedProfile,
    );
    return effectiveManifest as ExtensionManifestRecord;
  }

  private async resolveSelectionProfile(
    extensionId: string,
    version: string,
    requestedProfile?: string,
  ): Promise<string> {
    const packageDir = this.installedVersionCatalog.get(extensionId)?.get(version);
    if (!packageDir) {
      throw this.validationError(`扩展未安装，无法解析 activation profile: ${extensionId}@${version}`);
    }
    const manifest = await this.readExtensionManifest(extensionId, packageDir);
    return resolveExtensionActivationProfile(
      manifest as ExtensionManifest,
      {
        productId: this.productId,
        platform: currentExtensionPlatform(),
        features: ExtensionManager.ACTIVATION_PROFILE_FEATURES,
      },
      requestedProfile,
    ).selected.id;
  }

  private async loadExtensionConfig(extensionId: string): Promise<Record<string, unknown>> {
    const configPath = resolveConfigPath(path.join('extensions', `${extensionId}.yaml`), this.hostService.getRepoRoot());
    if (!(await fs.pathExists(configPath))) return {};
    const parsed = yaml.parse(await fs.readFile(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw this.validationError(`扩展配置必须是对象: ${extensionId}`);
    return parsed as Record<string, unknown>;
  }

  private assertEngineCompatibility(extensionId: string, manifest: ExtensionManifestRecord): void {
    const appVersion = this.hostService.getConfig().identity.app_version;
    const requiredAppVersion = manifest.engines.glimmerCradle ?? manifest.minAppVersion;
    if (!isVersionCompatible(appVersion, requiredAppVersion)) throw this.validationError(`扩展 ${extensionId} 要求摇篮版本 ${requiredAppVersion}，当前 ${appVersion}`);
    if (manifest.engines.node && !isVersionCompatible(process.versions.node, manifest.engines.node)) {
      throw this.validationError(`扩展 ${extensionId} 要求 Node.js ${manifest.engines.node}，当前 ${process.versions.node}`);
    }
  }

  private assertProductCompatibility(extensionId: string, manifest: ExtensionManifestRecord): void {
    if (!manifest.products.includes('any') && !manifest.products.includes(this.productId)) {
      throw this.validationError(`扩展 ${extensionId} 不支持当前产品: ${this.productId}`);
    }
  }

  private async prepareExternalDependencies(extensionId: string, manifest: ExtensionManifestRecord): Promise<void> {
    const managedResources = getManagedResourceContributions(manifest);
    if (!managedResources.length) return;
    await new ExtensionDependencyInstaller(this.hostService.getRepoRoot(), this.logger).prepare(extensionId, managedResources);
  }

  private async inspectManagedResources(extensionId: string, manifest: ExtensionManifestRecord): Promise<void> {
    const managedResources = getManagedResourceContributions(manifest);
    const nodes = managedResources.length
      ? await new ManagedResourceSupervisor(this.hostService.getRepoRoot(), this.logger).inspect(extensionId, managedResources)
      : [];
    this.hostService.mergeExtensionCapabilityGraph(extensionId, { nodes });
  }

  private registerDeclaredSkillEntries(extensionId: string, manifest: ExtensionManifestRecord): Disposable[] {
    const skills = getExtensionContributions<ExtensionSkillContribution>(manifest, BuiltInContributionPoint.skill);
    return skills.length ? this.hostService.registerDeclaredSkills(extensionId, skills) : [];
  }

  private registerDeclaredSkillEntriesIfNeeded(extensionId: string, item: ExtensionInstance): void {
    if (!item.declaredSkillDisposables.length) item.declaredSkillDisposables = this.registerDeclaredSkillEntries(extensionId, item.manifest);
  }

  private async disposeDeclaredSkillEntries(item: ExtensionInstance): Promise<void> {
    for (const disposable of item.declaredSkillDisposables.reverse()) await Promise.resolve(disposable.dispose()).catch(() => undefined);
    item.declaredSkillDisposables = [];
  }

  private resolvePublicCommandOwner(commandId: string): ExtensionInstance {
    const item = [...this.extensions.values()]
      .filter((candidate) => commandId.startsWith(`${candidate.manifest.id}.`) || commandId.startsWith(`${candidate.manifest.id}:`))
      .sort((left, right) => right.manifest.id.length - left.manifest.id.length)[0];
    if (!item) throw this.validationError(`未找到扩展命令所属扩展: ${commandId}`);
    const declared = getExtensionContributions<ExtensionCommandContribution>(item.manifest, BuiltInContributionPoint.command)
      .some((command) => command.command === commandId);
    if (!declared) throw new ExtensionException(`扩展命令未在 glimmer.command 中声明: ${commandId}`, ErrorCode.EXTENSION_PERMISSION_DENIED);
    return item;
  }

  private publishError(extensionId: string, error: unknown): void {
    this.hostService.publishDomainEvent(new ExtensionErrorEvent({
      extensionId,
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, createTraceContext()));
  }

  private syncRuntimeReadiness(): void {
    RuntimeReadinessCatalogStore.instance.replaceModuleSnapshots('extension-runtime', this.getReadinessSnapshots());
  }

  private validationError(message: string): ExtensionException {
    return new ExtensionException(message, ErrorCode.EXTENSION_VALIDATION_FAILED);
  }

  private getPackageManager(): ExtensionPackageManager {
    if (!this.packageManager) throw this.validationError('扩展包管理器尚未初始化');
    return this.packageManager;
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function compareVersionsDescending(left: string, right: string): number {
  return rcompare(left, right);
}

function isVersionCompatible(current: string, required: string): boolean {
  const currentVersion = valid(current);
  if (!currentVersion) return false;
  const exactMinimum = valid(required);
  if (exactMinimum) return gte(currentVersion, exactMinimum);
  const range = validRange(required);
  return range ? satisfies(currentVersion, range, { includePrerelease: true }) : false;
}
