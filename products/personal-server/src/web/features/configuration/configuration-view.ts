import type {
  AccessTokenMutationResult,
  AccessTokenSnapshot,
  DeploymentOperationResult,
  DeploymentOperationsSnapshot,
  SkillCatalogLoadResult,
} from '../../shared/api/personal-server-client';
import type {
  ConfigurationSnapshot,
  ConfigurationTestRequest,
  ConfigurationTestResult,
  ConfigurationUpdateRequest,
  ConfigurationUpdateResult,
} from '@glimmer-cradle/protocol';
import {
  createProviderDraft,
  mergeDiscoveredModels,
  snapshotToDraft,
  type ConfigurationDraftState,
  type ConfigurationStatusState,
  type ProviderDraftState,
} from './configuration-state';
import {
  buildUpdateRequest,
  isDraftDirty,
  routeModelOptions,
  toProviderTestDraft,
  validateDraft,
} from './configuration-draft-helpers';
import {
  bindSupplementalActions,
  refreshSupplementalSnapshots,
  type SupplementalControllerContext,
} from './configuration-supplemental-state';
import { bindSystemSectionInputs } from './configuration-system-bindings';
import {
  asErrorMessage,
  createRequestId,
  escapeAttribute,
  escapeHtml,
} from './configuration-support';
import { renderAudioSection } from './audio/audio-section';
import { renderEmbeddingSection } from './embedding/embedding-section';
import { renderMemoryExperienceSection } from './memory/memory-experience-section';
import {
  renderModelRoutingSection,
  renderRouteSummarySection,
} from './model-routing/model-routing-section';
import { renderProvidersSection } from './providers/providers-section';
import { renderSecurityAccessSection } from './security/security-access-section';
import { renderSkillsSection } from './skills/skills-section';
import { renderStorageBackupSection } from './storage/storage-backup-section';
import { renderUpdatesServiceSection } from './updates/updates-service-section';

export interface ConfigurationViewOptions {
  readonly onPreview: (request: ConfigurationUpdateRequest) => Promise<ConfigurationUpdateResult>;
  readonly onSave: (request: ConfigurationUpdateRequest) => Promise<ConfigurationUpdateResult>;
  readonly onTestProvider: (request: ConfigurationTestRequest) => Promise<ConfigurationTestResult>;
  readonly loadAccessTokens: () => Promise<AccessTokenSnapshot>;
  readonly createAccessToken: (label: string) => Promise<AccessTokenMutationResult>;
  readonly rotateAccessToken: (tokenId: string) => Promise<AccessTokenMutationResult>;
  readonly revokeAccessToken: (tokenId: string) => Promise<AccessTokenMutationResult>;
  readonly loadOperations: () => Promise<DeploymentOperationsSnapshot>;
  readonly runOperation: (
    operation: string,
    options?: { readonly backupId?: string; readonly confirm?: boolean },
  ) => Promise<DeploymentOperationResult>;
  readonly loadSkillCatalog: () => Promise<SkillCatalogLoadResult>;
}

export class ConfigurationView {
  private snapshot: ConfigurationSnapshot | null = null;
  private draft: ConfigurationDraftState | null = null;
  private selectedProviderKey = '';
  private status: ConfigurationStatusState = { kind: 'idle' };
  private accessTokens: AccessTokenSnapshot | null = null;
  private accessTokenResult: AccessTokenMutationResult | null = null;
  private accessTokenPending = false;
  private accessTokenError: string | null = null;
  private operations: DeploymentOperationsSnapshot | null = null;
  private operationResult: DeploymentOperationResult | null = null;
  private operationPending = false;
  private operationsError: string | null = null;
  private skillCatalog: SkillCatalogLoadResult | null = null;
  private skillCatalogPending = false;

  public constructor(private readonly root: HTMLElement, private readonly options: ConfigurationViewOptions) {}

  public renderLoading(message = '正在读取配置快照…'): void {
    this.root.innerHTML = `
      <header class="workspace-head"><div><span>设置</span><h1>服务配置</h1></div></header>
      <div class="settings-scroll">
        <section class="settings-section settings-empty"><h2>设置中心</h2><p>${escapeHtml(message)}</p></section>
      </div>
    `;
  }

  public renderSnapshot(snapshot: ConfigurationSnapshot): void {
    this.snapshot = snapshot;
    this.draft = snapshotToDraft(snapshot);
    this.selectedProviderKey = this.selectedProviderKey && this.draft.providers.some((provider) => provider.key === this.selectedProviderKey)
      ? this.selectedProviderKey
      : this.draft.providers[0]?.key ?? '';
    this.status = { kind: 'idle' };
    this.render();
    void refreshSupplementalSnapshots(this.supplementalContext());
  }

  private render(): void {
    if (!this.snapshot || !this.draft) {
      this.renderLoading();
      return;
    }
    const snapshot = this.snapshot;
    const draft = this.draft;
    const selected = draft.providers.find((provider) => provider.key === this.selectedProviderKey) ?? null;
    const dirty = isDraftDirty(this.snapshot, this.draft);
    const previewable = dirty && validateDraft(this.draft) === null;

    this.root.innerHTML = `
      <header class="workspace-head">
        <div><span>设置</span><h1>服务配置</h1></div>
        <div class="settings-actions">
          <button class="quiet-button" type="button" data-action="reload">刷新</button>
        </div>
      </header>
      <div class="settings-scroll">
        <div class="settings-grid settings-grid-wide">
          ${renderRouteSummarySection(snapshot.llm.default_route)}
          ${renderProvidersSection(draft.providers, this.selectedProviderKey, selected)}
          ${renderModelRoutingSection(draft, routeModelOptions(draft))}
          <div class="settings-system-grid">
            ${renderAudioSection(draft)}
            ${renderEmbeddingSection(draft)}
            ${renderMemoryExperienceSection(draft)}
            ${renderSkillsSection(draft, this.skillCatalog, this.skillCatalogPending)}
            ${renderSecurityAccessSection(this.accessTokens, this.accessTokenPending, this.accessTokenResult, this.accessTokenError)}
            ${renderStorageBackupSection(snapshot, this.operations, this.operationResult, this.operationPending, this.operationsError)}
            ${renderUpdatesServiceSection(snapshot, this.operations, this.operationResult, this.operationPending, this.operationsError)}
          </div>

          <section class="settings-section save-bar">
            <div>
              <span>修订</span>
              <strong>${escapeHtml(draft.revision)}</strong>
            </div>
            <div class="save-status ${this.status.kind}">
              ${this.renderStatus()}
            </div>
            <div class="save-actions">
              <button class="quiet-button" type="button" data-action="discard" ${dirty ? '' : 'disabled'}>丢弃修改</button>
              <button class="quiet-button" type="button" data-action="preview" ${previewable ? '' : 'disabled'}>预览变更</button>
              <button class="primary-button" type="button" data-action="save" ${previewable ? '' : 'disabled'}>保存并应用</button>
            </div>
          </section>
        </div>
      </div>
    `;

    this.bind();
  }

  private renderStatus(): string {
    if (!this.status.message && (!this.status.summary || this.status.summary.length === 0)) {
      return '<span>当前没有未提交的状态消息。</span>';
    }
    const summary = this.status.summary && this.status.summary.length > 0
      ? `<ul>${this.status.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';
    return `<div><strong>${escapeHtml(this.status.message || '')}</strong>${summary}</div>`;
  }

  private bind(): void {
    this.root.querySelector('[data-action="reload"]')?.addEventListener('click', () => {
      this.renderLoading('正在等待上层重新读取配置快照…');
      this.root.dispatchEvent(new CustomEvent('configuration:reload', { bubbles: true }));
    });

    this.root.querySelector('[data-action="discard"]')?.addEventListener('click', () => {
      if (!this.snapshot) return;
      this.draft = snapshotToDraft(this.snapshot);
      this.status = { kind: 'idle' };
      this.selectedProviderKey = this.draft.providers[0]?.key ?? '';
      this.render();
    });

    this.root.querySelector('[data-action="add-provider"]')?.addEventListener('click', () => {
      if (!this.draft) return;
      const provider = createProviderDraft(this.nextProviderKey());
      this.draft.providers.push(provider);
      this.selectedProviderKey = provider.key;
      this.render();
    });

    this.root.querySelector('[data-action="remove-provider"]')?.addEventListener('click', () => {
      if (!this.draft || !this.selectedProviderKey) return;
      this.draft.providers = this.draft.providers.filter((provider) => provider.key !== this.selectedProviderKey);
      if (this.draft.defaultRouteProviderKey === this.selectedProviderKey) {
        this.draft.defaultRouteProviderKey = '';
        this.draft.defaultRouteModelAlias = '';
      }
      this.selectedProviderKey = this.draft.providers[0]?.key ?? '';
      this.render();
    });

    this.root.querySelector('[data-action="add-model"]')?.addEventListener('click', () => {
      const provider = this.selectedProvider();
      if (!provider) return;
      provider.models.push({ alias: '', model_id: '' });
      this.render();
    });

    for (const button of Array.from(this.root.querySelectorAll<HTMLElement>('[data-provider]'))) {
      button.addEventListener('click', () => {
        this.selectedProviderKey = button.dataset.provider || '';
        this.render();
      });
    }

    for (const button of Array.from(this.root.querySelectorAll<HTMLElement>('[data-action="remove-model"]'))) {
      button.addEventListener('click', () => {
        const provider = this.selectedProvider();
        const index = Number(button.getAttribute('data-model-index'));
        if (!provider || !Number.isInteger(index)) return;
        provider.models.splice(index, 1);
        this.render();
      });
    }

    this.bindFieldInputs();
    bindSystemSectionInputs(this.root, {
      getDraft: () => this.draft,
      render: () => this.render(),
    });
    bindSupplementalActions(this.supplementalContext());

    this.root.querySelector('[data-action="preview"]')?.addEventListener('click', async () => {
      const request = buildUpdateRequest(this.snapshot, this.draft, true);
      if ('error' in request) {
        this.status = { kind: 'error', message: request.error };
        this.render();
        return;
      }
      this.status = { kind: 'loading', message: '正在生成变更预览…' };
      this.render();
      try {
        const result = await this.options.onPreview(request);
        this.applyResult(result, 'preview');
      } catch (error) {
        this.status = { kind: 'error', message: asErrorMessage(error) };
        this.render();
      }
    });

    this.root.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
      const request = buildUpdateRequest(this.snapshot, this.draft, false);
      if ('error' in request) {
        this.status = { kind: 'error', message: request.error };
        this.render();
        return;
      }
      this.status = { kind: 'saving', message: '正在提交配置并等待 apply 状态…' };
      this.render();
      try {
        const result = await this.options.onSave(request);
        this.applyResult(result, 'save');
      } catch (error) {
        this.status = { kind: 'error', message: asErrorMessage(error) };
        this.render();
      }
    });

    this.root.querySelector('[data-action="test-provider"]')?.addEventListener('click', async () => {
      const providerDraft = toProviderTestDraft(this.selectedProvider());
      if (!providerDraft) {
        this.status = { kind: 'error', message: '当前 Provider 还不完整，无法测试。' };
        this.render();
        return;
      }
      this.status = { kind: 'loading', message: '正在测试连接…' };
      this.render();
      try {
        const result = await this.options.onTestProvider({
          request_id: createRequestId('provider-test'),
          provider: providerDraft,
        });
        if (result.status === 'success' && result.discovered_models.length > 0) {
          const provider = this.selectedProvider();
          const draft = this.draft;
          if (provider) {
            provider.models = mergeDiscoveredModels(provider.models, result.discovered_models);
            const providerRouteOptions = provider.models.filter((model) => model.alias && model.model_id);
            if (draft?.defaultRouteProviderKey === provider.key && !providerRouteOptions.some((model) => model.alias === draft.defaultRouteModelAlias)) {
              draft.defaultRouteModelAlias = providerRouteOptions[0]?.alias ?? '';
            }
          }
        }
        this.status = {
          kind: result.status === 'success' ? 'success' : 'error',
          message: result.message,
          summary: result.discovered_models.length > 0 ? result.discovered_models.slice(0, 8).map((id) => `发现模型 ${id}`) : undefined,
        };
        this.render();
      } catch (error) {
        this.status = { kind: 'error', message: asErrorMessage(error) };
        this.render();
      }
    });
  }

  private bindFieldInputs(): void {
    this.bindInput('[data-field="provider-key"]', (value) => {
      const provider = this.selectedProvider();
      if (!provider) return;
      if (this.draft?.defaultRouteProviderKey === provider.key) {
        this.draft.defaultRouteProviderKey = value.trim();
      }
      provider.key = value.trim();
      this.selectedProviderKey = provider.key;
    });
    this.bindInput('[data-field="provider-api-type"]', (value) => {
      const provider = this.selectedProvider();
      if (provider) provider.api_type = value.trim();
    });
    this.bindInput('[data-field="provider-base-url"]', (value) => {
      const provider = this.selectedProvider();
      if (provider) provider.base_url = value.trim();
    });
    this.bindInput('[data-field="provider-api-key"]', (value) => {
      const provider = this.selectedProvider();
      if (provider) provider.api_key = value;
    });
    this.bindInput('[data-field="provider-temperature"]', (value) => {
      const provider = this.selectedProvider();
      if (provider) provider.temperature = value.trim();
    });
    this.bindCheckbox('[data-field="provider-clear-secret"]', (checked) => {
      const provider = this.selectedProvider();
      if (provider) provider.clear_api_key = checked;
    });
    this.bindSelect('[data-field="default-route-provider"]', (value) => {
      const draft = this.draft;
      if (!draft) return;
      draft.defaultRouteProviderKey = value;
      const candidate = routeModelOptions(draft);
      draft.defaultRouteModelAlias = candidate.find((model) => model.alias === draft.defaultRouteModelAlias)?.alias
        ?? candidate[0]?.alias
        ?? '';
      this.render();
    });
    this.bindSelect('[data-field="default-route-model"]', (value) => {
      if (this.draft) this.draft.defaultRouteModelAlias = value;
    });

    for (const input of Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-model-alias]'))) {
      input.addEventListener('input', () => {
        const provider = this.selectedProvider();
        const index = Number(input.getAttribute('data-model-alias'));
        if (!provider || !Number.isInteger(index)) return;
        provider.models[index].alias = input.value.trim();
      });
    }
    for (const input of Array.from(this.root.querySelectorAll<HTMLInputElement>('[data-model-id]'))) {
      input.addEventListener('input', () => {
        const provider = this.selectedProvider();
        const index = Number(input.getAttribute('data-model-id'));
        if (!provider || !Number.isInteger(index)) return;
        provider.models[index].model_id = input.value.trim();
      });
    }
  }

  private bindInput(selector: string, onInput: (value: string) => void): void {
    const element = this.root.querySelector<HTMLInputElement>(selector);
    element?.addEventListener('input', () => onInput(element.value));
  }

  private bindCheckbox(selector: string, onChange: (checked: boolean) => void): void {
    const element = this.root.querySelector<HTMLInputElement>(selector);
    element?.addEventListener('change', () => onChange(element.checked));
  }

  private bindSelect(selector: string, onChange: (value: string) => void): void {
    const element = this.root.querySelector<HTMLSelectElement>(selector);
    element?.addEventListener('change', () => onChange(element.value));
  }

  private selectedProvider(): ProviderDraftState | null {
    return this.draft?.providers.find((provider) => provider.key === this.selectedProviderKey) ?? null;
  }

  private routeModelOptions(): Array<{ alias: string; model_id: string }> {
    const draft = this.draft;
    if (!draft?.defaultRouteProviderKey) return [];
    return (draft.providers.find((provider) => provider.key === draft.defaultRouteProviderKey)?.models ?? [])
      .filter((model) => model.alias && model.model_id);
  }

  private nextProviderKey(): string {
    const existing = new Set(this.draft?.providers.map((provider) => provider.key) ?? []);
    let index = 1;
    while (existing.has(`provider-${index}`)) index += 1;
    return `provider-${index}`;
  }

  private applyResult(result: ConfigurationUpdateResult, mode: 'preview' | 'save'): void {
    if (result.snapshot) {
      this.snapshot = result.snapshot;
    }
    if (result.status === 'preview') {
      this.status = {
        kind: 'preview',
        message: result.message || '已生成变更预览。',
        summary: result.change_summary,
      };
      this.render();
      return;
    }
    if (result.status === 'success' && result.snapshot) {
      this.snapshot = result.snapshot;
      this.draft = snapshotToDraft(result.snapshot);
      this.selectedProviderKey = this.draft.providers.find((provider) => provider.key === this.selectedProviderKey)?.key
        ?? this.draft.providers[0]?.key
        ?? '';
      this.status = {
        kind: result.apply_state === 'failed' ? 'error' : 'success',
        message: result.message || (mode === 'save'
          ? `配置已保存，apply 状态：${result.apply_state}`
          : '预览完成。'),
        summary: result.change_summary,
      };
      this.render();
      void refreshSupplementalSnapshots(this.supplementalContext());
      return;
    }
    this.status = {
      kind: 'error',
      message: result.message || '配置提交失败。',
      summary: result.change_summary,
    };
    this.render();
  }

  private supplementalContext(): SupplementalControllerContext {
    return {
      root: this.root,
      options: this.options,
      render: () => this.render(),
      asErrorMessage,
      accessTokens: {
        getSnapshot: () => this.accessTokens,
        setSnapshot: (value) => { this.accessTokens = value; },
        setResult: (value) => { this.accessTokenResult = value; },
        setPending: (value) => { this.accessTokenPending = value; },
        getError: () => this.accessTokenError,
        setError: (value) => { this.accessTokenError = value; },
      },
      operations: {
        getSnapshot: () => this.operations,
        setSnapshot: (value) => { this.operations = value; },
        setResult: (value) => { this.operationResult = value; },
        setPending: (value) => { this.operationPending = value; },
        getError: () => this.operationsError,
        setError: (value) => { this.operationsError = value; },
      },
      skills: {
        getCatalog: () => this.skillCatalog,
        setCatalog: (value) => { this.skillCatalog = value; },
        setPending: (value) => { this.skillCatalogPending = value; },
      },
    };
  }
}
