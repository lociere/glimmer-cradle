import type {
  ExtensionInstallCommitRequest,
  ExtensionInstallPreview,
  ExtensionInstallPrepareRequest,
  ExtensionInstallResult,
  ExtensionLifecycleRequest,
  ExtensionRuntimeProjection,
  ExtensionRuntimeProjectionResult,
  ExtensionUninstallRequest,
} from '@glimmer-cradle/protocol';
import type {
  LocalExtensionUploadResult,
  PersonalServerSurface,
  SurfaceFrame,
} from '../../shared/api/personal-server-client';
import {
  buildExtensionVersionRows,
  type ExtensionInstallationView,
} from './extension-version-support';

type InstallSourceKind = 'file' | 'registry' | 'repository' | 'release_manifest';

interface InstallDraftState {
  sourceKind: InstallSourceKind;
  catalogUrl: string;
  extensionId: string;
  channel: '' | 'stable' | 'beta' | 'nightly';
  repository: string;
  tag: string;
  manifestUrl: string;
  localPackageName: string;
  localPackageUploadId: string;
  localPackageSize: number;
  localPackageExpiresAt: string;
}

interface ExtensionOperationState {
  kind: 'idle' | 'loading' | 'success' | 'error';
  message: string;
}

export class ExtensionView {
  private connected = false;
  private loading = false;
  private operation: ExtensionOperationState = { kind: 'idle', message: '' };
  private projections = new Map<string, ExtensionRuntimeProjection>();
  private installations = new Map<string, ExtensionInstallationView>();
  private preview: ExtensionInstallPreview | null = null;
  private draft: InstallDraftState = {
    sourceKind: 'repository',
    catalogUrl: '',
    extensionId: '',
    channel: 'stable',
    repository: '',
    tag: '',
    manifestUrl: '',
    localPackageName: '',
    localPackageUploadId: '',
    localPackageSize: 0,
    localPackageExpiresAt: '',
  };

  public constructor(
    private readonly root: HTMLElement,
    private readonly options: {
      readonly getSurface: () => PersonalServerSurface | null;
      readonly uploadLocalPackage: (file: File) => Promise<LocalExtensionUploadResult>;
    },
  ) {
    this.root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.action === 'extensions-reload') {
        void this.reload();
        return;
      }
      if (target.dataset.action === 'extensions-prepare') {
        void this.prepareInstall();
        return;
      }
      if (target.dataset.action === 'extensions-commit' && this.preview?.transaction_id) {
        void this.commitInstall(this.preview);
        return;
      }
      if (target.dataset.action === 'extensions-cancel' && this.preview?.transaction_id) {
        void this.cancelInstall(this.preview.transaction_id);
        return;
      }
      if (target.dataset.action === 'extension-start') {
        const extensionId = target.dataset.extensionId;
        const version = target.dataset.version;
        if (extensionId) void this.changeLifecycle(extensionId, 'start', version);
        return;
      }
      if (target.dataset.action === 'extension-stop') {
        const extensionId = target.dataset.extensionId;
        const version = target.dataset.version;
        if (extensionId) void this.changeLifecycle(extensionId, 'stop', version);
        return;
      }
      if (target.dataset.action === 'extension-activate-version') {
        const extensionId = target.dataset.extensionId;
        const version = target.dataset.version;
        if (extensionId && version) void this.changeLifecycle(extensionId, 'start', version);
        return;
      }
      if (target.dataset.action === 'extension-uninstall') {
        const extensionId = target.dataset.extensionId;
        const version = target.dataset.version;
        if (extensionId && version) void this.confirmAndUninstall(extensionId, version);
      }
    });

    this.root.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (target instanceof HTMLInputElement && target.type === 'file') return;
      switch (target.dataset.field) {
        case 'source-kind':
          this.draft.sourceKind = target.value as InstallSourceKind;
          this.render();
          return;
        case 'catalog-url':
          this.draft.catalogUrl = target.value.trim();
          return;
        case 'extension-id':
          this.draft.extensionId = target.value.trim();
          return;
        case 'channel':
          this.draft.channel = target.value as InstallDraftState['channel'];
          return;
        case 'repository':
          this.draft.repository = target.value.trim();
          return;
        case 'tag':
          this.draft.tag = target.value.trim();
          return;
        case 'manifest-url':
          this.draft.manifestUrl = target.value.trim();
          return;
      }
    });

    this.root.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.type !== 'file' || target.dataset.field !== 'local-package') return;
      void this.uploadLocalPackage(target.files?.[0] ?? null);
    });
  }

  public async handleSurfaceOpen(): Promise<void> {
    this.connected = true;
    await this.reload();
  }

  public handleSurfaceClose(): void {
    this.connected = false;
    this.render();
  }

  public handleFrame(frame: SurfaceFrame): void {
    if (frame.kind === 'extension_runtime_projection_changed' && frame.extension_runtime_projection_changed) {
      this.projections.set(frame.extension_runtime_projection_changed.extension_id, frame.extension_runtime_projection_changed);
      this.render();
      return;
    }
    if (frame.kind === 'extension_install_result' && frame.extension_install_result) {
      this.operation = {
        kind: frame.extension_install_result.status === 'success' ? 'success' : 'error',
        message: frame.extension_install_result.message || describeInstallResult(frame.extension_install_result),
      };
      if (frame.extension_install_result.status !== 'error') {
        this.preview = null;
        void this.reload();
      } else {
        this.render();
      }
      return;
    }
    if (frame.kind === 'extension_lifecycle_result' && frame.extension_lifecycle_result) {
      this.operation = {
        kind: frame.extension_lifecycle_result.status === 'success' ? 'success' : 'error',
        message: frame.extension_lifecycle_result.message || `扩展 ${frame.extension_lifecycle_result.operation} 已提交。`,
      };
      void this.reload();
      return;
    }
    if (frame.kind === 'extension_uninstall_result' && frame.extension_uninstall_result) {
      this.operation = {
        kind: frame.extension_uninstall_result.status === 'success' ? 'success' : 'error',
        message: frame.extension_uninstall_result.message || '扩展卸载已提交。',
      };
      void this.reload();
    }
  }

  public reset(): void {
    this.connected = false;
    this.loading = false;
    this.operation = { kind: 'idle', message: '' };
    this.preview = null;
    this.projections.clear();
    this.installations.clear();
    this.render();
  }

  public renderLoading(message = '正在读取扩展运行投影…'): void {
    this.loading = true;
    this.operation = { kind: 'loading', message };
    this.render();
  }

  private async reload(): Promise<void> {
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) {
      this.connected = false;
      this.render();
      return;
    }
    this.loading = true;
    this.render();
    try {
      const result = await surface.requestExtensionRuntimeProjection({
        request_id: createRequestId('extension-runtime'),
      });
      this.applyProjectionResult(result);
      this.operation = this.operation.kind === 'error' ? this.operation : { kind: 'idle', message: '' };
    } catch (error) {
      this.operation = {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private applyProjectionResult(result: ExtensionRuntimeProjectionResult): void {
    this.projections = new Map(result.projections.map((projection) => [projection.extension_id, projection]));
    this.installations = new Map(result.installations.map((installation) => [installation.extension_id, {
      installedVersions: [...installation.installed_versions],
      activeVersion: installation.active_version,
      updatedAt: installation.updated_at,
    }]));
  }

  private async prepareInstall(): Promise<void> {
    const request = this.buildPrepareRequest();
    if (!request) {
      this.operation = { kind: 'error', message: '安装来源还不完整，无法生成预览。' };
      this.render();
      return;
    }
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) {
      this.operation = { kind: 'error', message: 'Control Surface 未连接，无法准备扩展安装。' };
      this.render();
      return;
    }
    this.operation = { kind: 'loading', message: '正在生成扩展安装预览…' };
    this.render();
    try {
      this.preview = await surface.prepareExtensionInstall(request);
      this.operation = {
        kind: this.preview.status === 'ready' ? 'success' : 'error',
        message: this.preview.message || (this.preview.status === 'ready' ? '扩展预览已就绪。' : '扩展预览失败。'),
      };
    } catch (error) {
      this.operation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    this.render();
  }

  private async commitInstall(preview: ExtensionInstallPreview): Promise<void> {
    if (!preview.transaction_id) return;
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) return;
    const request: ExtensionInstallCommitRequest = {
      request_id: createRequestId('extension-install'),
      transaction_id: preview.transaction_id,
      approved_permissions: preview.extension?.permissions ?? [],
    };
    this.operation = { kind: 'loading', message: '正在提交扩展安装事务…' };
    this.render();
    try {
      const result = await surface.commitExtensionInstall(request);
      this.operation = {
        kind: result.status === 'success' ? 'success' : 'error',
        message: result.message || describeInstallResult(result),
      };
      if (result.status !== 'error') {
        this.preview = null;
        await this.reload();
      }
    } catch (error) {
      this.operation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async cancelInstall(transactionId: string): Promise<void> {
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) return;
    this.operation = { kind: 'loading', message: '正在取消扩展安装事务…' };
    this.render();
    try {
      await surface.cancelExtensionInstall(createRequestId('extension-install-cancel'), transactionId);
      this.preview = null;
      this.operation = { kind: 'success', message: '扩展安装预览已取消。' };
      this.render();
    } catch (error) {
      this.operation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async changeLifecycle(extensionId: string, operation: ExtensionLifecycleRequest['operation'], version?: string): Promise<void> {
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) return;
    this.operation = { kind: 'loading', message: `正在${operation === 'start' ? '启用' : '停用'}扩展 ${extensionId}…` };
    this.render();
    try {
      await surface.requestExtensionLifecycle({
        request_id: createRequestId(`extension-${operation}`),
        extension_id: extensionId,
        version: version || undefined,
        operation,
      });
    } catch (error) {
      this.operation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async uninstall(extensionId: string, version: string): Promise<void> {
    const surface = this.options.getSurface();
    if (!surface || surface.readyState !== WebSocket.OPEN) return;
    const request: ExtensionUninstallRequest = {
      request_id: createRequestId('extension-uninstall'),
      extension_id: extensionId,
      version,
    };
    this.operation = { kind: 'loading', message: `正在卸载 ${extensionId}@${version}…` };
    this.render();
    try {
      await surface.uninstallExtension(request);
    } catch (error) {
      this.operation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async confirmAndUninstall(extensionId: string, version: string): Promise<void> {
    if (!window.confirm(`确认卸载 ${extensionId}@${version}？已安装的旧版本记录会同步移除。`)) {
      return;
    }
    await this.uninstall(extensionId, version);
  }

  private buildPrepareRequest(): ExtensionInstallPrepareRequest | null {
    switch (this.draft.sourceKind) {
      case 'file':
        if (!this.draft.localPackageUploadId) return null;
        return {
          request_id: createRequestId('extension-prepare'),
          source: {
            kind: 'uploaded_package',
            upload_id: this.draft.localPackageUploadId,
          },
        };
      case 'registry':
        if (!this.draft.catalogUrl || !this.draft.extensionId) return null;
        return {
          request_id: createRequestId('extension-prepare'),
          source: {
            kind: 'registry',
            catalog_url: this.draft.catalogUrl,
            extension_id: this.draft.extensionId,
            channel: this.draft.channel || undefined,
          },
        };
      case 'repository':
        if (!this.draft.repository || !this.draft.tag) return null;
        return {
          request_id: createRequestId('extension-prepare'),
          source: {
            kind: 'repository',
            repository: this.draft.repository,
            tag: this.draft.tag,
          },
        };
      case 'release_manifest':
        if (!this.draft.manifestUrl) return null;
        return {
          request_id: createRequestId('extension-prepare'),
          source: {
            kind: 'release_manifest',
            url: this.draft.manifestUrl,
          },
        };
      default:
        return null;
    }
  }

  private async uploadLocalPackage(file: File | null): Promise<void> {
    if (!file) {
      this.draft.localPackageName = '';
      this.draft.localPackageUploadId = '';
      this.draft.localPackageSize = 0;
      this.draft.localPackageExpiresAt = '';
      this.render();
      return;
    }
    this.operation = { kind: 'loading', message: `正在上传 ${file.name}…` };
    this.render();
    try {
      const uploaded = await this.options.uploadLocalPackage(file);
      this.draft.localPackageUploadId = uploaded.upload_id;
      this.draft.localPackageName = uploaded.file_name;
      this.draft.localPackageSize = uploaded.size;
      this.draft.localPackageExpiresAt = uploaded.expires_at;
      this.operation = { kind: 'success', message: `本地扩展包已上传：${uploaded.file_name}` };
    } catch (error) {
      this.draft.localPackageName = '';
      this.draft.localPackageUploadId = '';
      this.draft.localPackageSize = 0;
      this.draft.localPackageExpiresAt = '';
      this.operation = { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    this.render();
  }

  private render(): void {
    const extensions = this.collectExtensions();
    this.root.innerHTML = `
      <header class="workspace-head">
        <div><span>能力</span><h1>扩展</h1></div>
        <div class="settings-actions">
          <button class="quiet-button" type="button" data-action="extensions-reload">刷新</button>
        </div>
      </header>
      <div class="extension-scroll">
        <section class="extension-install-section" data-role="extension-install-section">
          <div class="settings-section-head">
            <div><span>安装事务</span><h2>Local Package / Registry / Repository / Release Manifest</h2></div>
          </div>
          <div class="extension-install-grid">
            ${this.renderInstallForm()}
            ${this.renderInstallPreview()}
          </div>
        </section>
        <section class="extension-directory-section" data-role="extension-directory-section">
          <div class="settings-section-head">
            <div><span>运行投影</span><h2>Extension Host</h2></div>
          </div>
          <div class="save-status ${this.operation.kind}">
            ${escapeHtml(this.operation.message || (this.loading ? '正在读取扩展运行投影…' : this.connected ? '当前没有未完成的扩展操作。' : 'Control Surface 未连接。'))}
          </div>
          <div class="extension-card-list" data-role="extension-card-list">
            ${extensions.length > 0
              ? extensions.map((entry) => this.renderExtensionCard(entry)).join('')
              : `<div class="settings-section settings-empty"><h2>当前没有扩展投影</h2><p>${escapeHtml(this.connected ? 'Kernel 已连接，但还没有可展示的扩展安装态或运行态。' : '等待 Control Surface 连接后读取扩展运行投影。')}</p></div>`}
          </div>
        </section>
      </div>
    `;
  }

  private renderInstallForm(): string {
    return `
      <div class="settings-section extension-install-form" data-role="extension-install-form">
        <label class="field">
          <span>来源类型</span>
          <select data-field="source-kind">
            <option value="file" ${this.draft.sourceKind === 'file' ? 'selected' : ''}>本地 .gcex</option>
            <option value="repository" ${this.draft.sourceKind === 'repository' ? 'selected' : ''}>仓库 Release</option>
            <option value="registry" ${this.draft.sourceKind === 'registry' ? 'selected' : ''}>Registry 条目</option>
            <option value="release_manifest" ${this.draft.sourceKind === 'release_manifest' ? 'selected' : ''}>Release Manifest</option>
          </select>
        </label>
        ${this.draft.sourceKind === 'file' ? `
          <label class="field field-wide">
            <span>本地扩展包</span>
            <input type="file" data-field="local-package" accept=".gcex,application/octet-stream">
          </label>
          <div class="settings-empty-card" data-role="local-package-upload">
            <strong>${escapeHtml(this.draft.localPackageName || '尚未选择本地 .gcex')}</strong>
            <p>${escapeHtml(this.draft.localPackageUploadId
              ? `已换取受控 upload_id，大小 ${this.draft.localPackageSize} bytes，${describeUploadExpiry(this.draft.localPackageExpiresAt)}。浏览器不会看到或提交服务器文件路径。`
              : '浏览器只上传字节流到受控临时目录，不允许提交服务器任意文件路径。')}</p>
          </div>
        ` : ''}
        ${this.draft.sourceKind === 'repository' ? `
          <label class="field"><span>仓库</span><input type="text" data-field="repository" value="${escapeAttribute(this.draft.repository)}" placeholder="publisher/repo"></label>
          <label class="field"><span>Tag</span><input type="text" data-field="tag" value="${escapeAttribute(this.draft.tag)}" placeholder="v1.2.3"></label>
        ` : ''}
        ${this.draft.sourceKind === 'registry' ? `
          <label class="field field-wide"><span>Catalog URL</span><input type="url" data-field="catalog-url" value="${escapeAttribute(this.draft.catalogUrl)}" placeholder="https://registry.example/catalog.json"></label>
          <label class="field"><span>Extension ID</span><input type="text" data-field="extension-id" value="${escapeAttribute(this.draft.extensionId)}" placeholder="community.example"></label>
          <label class="field"><span>Channel</span>
            <select data-field="channel">
              <option value="stable" ${this.draft.channel === 'stable' ? 'selected' : ''}>stable</option>
              <option value="beta" ${this.draft.channel === 'beta' ? 'selected' : ''}>beta</option>
              <option value="nightly" ${this.draft.channel === 'nightly' ? 'selected' : ''}>nightly</option>
            </select>
          </label>
        ` : ''}
        ${this.draft.sourceKind === 'release_manifest' ? `
          <label class="field field-wide"><span>Manifest URL</span><input type="url" data-field="manifest-url" value="${escapeAttribute(this.draft.manifestUrl)}" placeholder="https://example/releases/manifest.json"></label>
        ` : ''}
        <div class="inline-actions extension-install-actions">
          <button class="primary-button" type="button" data-action="extensions-prepare" ${this.connected ? '' : 'disabled'}>生成安装预览</button>
        </div>
      </div>
    `;
  }

  private renderInstallPreview(): string {
    if (!this.preview) {
      return `
        <div class="settings-section settings-empty">
          <h2>安装预览</h2>
          <p>所有来源共用同一安装事务。预览阶段会返回兼容性、权限、摘要/签名元数据与失败原因。</p>
        </div>
      `;
    }
    const preview = this.preview;
    const trust = preview.trust;
    return `
      <div class="settings-section extension-preview ${preview.status === 'ready' ? 'is-ready' : 'is-error'}" data-role="extension-preview">
        <h2>${escapeHtml(preview.extension?.name || '扩展安装预览')}</h2>
        <p>${escapeHtml(preview.message || preview.extension?.description || '等待用户确认安装事务。')}</p>
        ${preview.extension ? `
          <div class="extension-meta-grid">
            <span>${escapeHtml(preview.extension.id)}</span>
            <span>${escapeHtml(preview.extension.version)}</span>
            <span>${escapeHtml(preview.extension.publisher)}</span>
            <span>${escapeHtml(preview.extension.platforms.join(', ') || '未声明平台')}</span>
          </div>
        ` : ''}
        ${preview.artifact ? `<p>SHA256 ${escapeHtml(preview.artifact.sha256)} · ${escapeHtml(String(preview.artifact.size))} bytes · ${escapeHtml(preview.artifact.platform)}</p>` : ''}
        ${trust ? `
          <ul class="extension-trust-list">
            <li>来源：${escapeHtml(trust.source_kind)}</li>
            <li>目录审核：${trust.listing_reviewed ? '已审阅' : '未审阅'}</li>
            <li>发布者验证：${trust.publisher_verified ? '已验证' : '未验证'}</li>
            <li>签名：${trust.artifact_signed ? '已签名' : '未签名'}</li>
            <li>构建证明：${trust.build_attested ? '已附带' : '未附带'}</li>
          </ul>
        ` : ''}
        ${preview.extension?.permissions?.length ? `<p>权限：${escapeHtml(preview.extension.permissions.join(', '))}</p>` : ''}
        <div class="inline-actions extension-install-actions">
          <button class="primary-button" type="button" data-action="extensions-commit" ${preview.status === 'ready' && this.connected ? '' : 'disabled'}>确认安装</button>
          <button class="quiet-button" type="button" data-action="extensions-cancel" ${preview.transaction_id ? '' : 'disabled'}>取消预览</button>
        </div>
      </div>
    `;
  }

  private renderExtensionCard(entry: ReturnType<ExtensionView['collectExtensions']>[number]): string {
    const activeVersion = entry.installation?.activeVersion;
    const startVersion = activeVersion || entry.installation?.installedVersions[0];
    const canStart = Boolean(startVersion) && entry.projection?.lifecycle !== 'running' && entry.projection?.lifecycle !== 'starting';
    const canStop = entry.projection?.lifecycle === 'running' || entry.projection?.lifecycle === 'starting';
    const versionRows = buildExtensionVersionRows(entry.installation, entry.projection);
    return `
      <article class="settings-section extension-card" data-role="extension-card" data-extension-id="${escapeAttribute(entry.id)}">
        <div class="extension-card-head">
          <div>
            <span>${escapeHtml(entry.id)}</span>
            <h2>${escapeHtml(entry.projection?.display_name || entry.id)}</h2>
          </div>
          <div class="extension-state-pill is-${escapeAttribute(entry.projection?.lifecycle || 'installed')}">${escapeHtml(entry.projection?.lifecycle || 'installed')}</div>
        </div>
        <p>${escapeHtml(entry.projection?.summary || entry.projection?.description || '当前没有额外摘要。')}</p>
        <div class="extension-meta-grid">
          <span>激活版本：${escapeHtml(activeVersion || '未激活')}</span>
          <span>已安装：${escapeHtml(entry.installation?.installedVersions.join(', ') || '无')}</span>
          <span>权限：${escapeHtml(entry.projection?.permissions.join(', ') || '无')}</span>
          <span>诊断：${escapeHtml(entry.projection?.diagnostics.summary || '无')}</span>
        </div>
        ${versionRows.length > 0 ? `
          <div class="extension-version-list" data-role="extension-version-list">
            ${versionRows.map((row) => `
              <div class="extension-version-row" data-role="extension-version-row" data-version="${escapeAttribute(row.version)}">
                <div>
                  <strong>${escapeHtml(row.version)}</strong>
                  <p>${escapeHtml(row.stateLabel)}</p>
                </div>
                <div class="inline-actions extension-version-actions">
                  <button class="quiet-button" type="button" data-action="extension-activate-version" data-extension-id="${escapeAttribute(entry.id)}" data-version="${escapeAttribute(row.version)}" ${row.canActivate && this.connected ? '' : 'disabled'}>${escapeHtml(row.actionLabel)}</button>
                  <button class="danger-button" type="button" data-action="extension-uninstall" data-extension-id="${escapeAttribute(entry.id)}" data-version="${escapeAttribute(row.version)}" ${row.canUninstall && this.connected ? '' : 'disabled'}>卸载此版本</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${entry.projection?.diagnostics.last_error ? `<p class="extension-error">${escapeHtml(entry.projection.diagnostics.last_error)}</p>` : ''}
        <div class="inline-actions extension-card-actions">
          <button class="quiet-button" type="button" data-action="extension-start" data-extension-id="${escapeAttribute(entry.id)}" data-version="${escapeAttribute(startVersion || '')}" ${canStart && this.connected ? '' : 'disabled'}>启用</button>
          <button class="quiet-button" type="button" data-action="extension-stop" data-extension-id="${escapeAttribute(entry.id)}" data-version="${escapeAttribute(activeVersion || '')}" ${canStop && this.connected ? '' : 'disabled'}>停用</button>
        </div>
      </article>
    `;
  }

  private collectExtensions(): Array<{
    id: string;
    projection?: ExtensionRuntimeProjection;
    installation?: {
      installedVersions: string[];
      activeVersion?: string;
      updatedAt: string;
    };
  }> {
    const ids = new Set([...this.projections.keys(), ...this.installations.keys()]);
    return [...ids].sort((left, right) => left.localeCompare(right)).map((id) => ({
      id,
      projection: this.projections.get(id),
      installation: this.installations.get(id),
    }));
  }
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeInstallResult(result: ExtensionInstallResult): string {
  if (result.status === 'success') {
    return `${result.extension_id || '扩展'} ${result.already_installed ? '已存在，已切换到当前版本。' : '安装完成。'}`;
  }
  if (result.status === 'cancelled') {
    return '扩展安装事务已取消。';
  }
  return '扩展安装失败。';
}

function describeUploadExpiry(value: string): string {
  if (!value) return '将在超时后自动清理';
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return '将在超时后自动清理';
  return `会话上传令牌有效至 ${expiresAt.toLocaleString()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
