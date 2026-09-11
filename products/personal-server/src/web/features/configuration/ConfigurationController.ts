import type { ConfigurationSnapshot, ConfigurationTestRequest, ConfigurationTestResult, ConfigurationUpdateRequest, ConfigurationUpdateResult } from '../../../shared/control-center-models';
import type { AccessTokenSnapshot, AccessTokenMutationResult, DeploymentOperationsSnapshot, DeploymentOperationResult, SkillCatalogLoadResult } from '../../shared/api/personal-server-client';
import { snapshotToDraft, mergeDiscoveredModels, type ConfigurationDraftState, type ConfigurationStatusState } from './configuration-state';
import { buildUpdateRequest, isDraftDirty, toProviderTestDraft } from './configuration-draft-helpers';
import { createRequestId } from '../../shared/request-id';

export interface ConfigurationPort {
  read(): Promise<ConfigurationSnapshot>;
  preview(request: ConfigurationUpdateRequest): Promise<ConfigurationUpdateResult>;
  save(request: ConfigurationUpdateRequest): Promise<ConfigurationUpdateResult>;
  testProvider(request: ConfigurationTestRequest): Promise<ConfigurationTestResult>;
  tokens(): Promise<AccessTokenSnapshot>;
  mutateToken(action: 'create' | 'rotate' | 'revoke', value: string): Promise<AccessTokenMutationResult>;
  operations(): Promise<DeploymentOperationsSnapshot>;
  runOperation(operation: string, options: { backupId?: string; confirm?: boolean; operationId: string }): Promise<DeploymentOperationResult>;
  operationResult(id: string): Promise<DeploymentOperationResult | null>;
  skills(): Promise<SkillCatalogLoadResult>;
  close(): void;
}
export interface ConfigurationState {
  configuration: ConfigurationSnapshot | null;
  draft: ConfigurationDraftState | null;
  connected: boolean;
  loading: boolean;
  pending: boolean;
  status: ConfigurationStatusState;
  tokens: AccessTokenSnapshot | null;
  tokenResult: AccessTokenMutationResult | null;
  tokenPending: boolean;
  tokenError: string | null;
  operations: DeploymentOperationsSnapshot | null;
  operationResult: DeploymentOperationResult | null;
  operationPending: boolean;
  operationsError: string | null;
  skills: SkillCatalogLoadResult | null;
  skillsPending: boolean;
}
const operationKey = 'glimmer-cradle.personal-server.active-operation';
const active = (result: DeploymentOperationResult) => ['accepted', 'started'].includes(result.status);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export class ConfigurationController {
  private state: ConfigurationState = { configuration: null, draft: null, connected: false, loading: false, pending: false, status: { kind: 'idle' }, tokens: null, tokenResult: null, tokenPending: false, tokenError: null, operations: null, operationResult: null, operationPending: false, operationsError: null, skills: null, skillsPending: false };
  private port: ConfigurationPort | null = null;
  private epoch = 0;
  private tokenRevealId = 0;
  private readId = 0;
  private supplementalId = 0;
  private tokenId = 0;
  private operationVersion = 0;
  private polling = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  public subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  public getSnapshot = () => this.state;
  private patch(patch: Partial<ConfigurationState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private current(epoch: number) { return epoch === this.epoch && this.port !== null; }
  public connect(port: ConfigurationPort | null) {
    this.port?.close(); this.port = port; this.epoch++; this.readId++; this.polling = false;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.patch({ connected: !!port, loading: false, pending: false, tokenPending: false, tokenResult: null, skillsPending: false, operationPending: !!this.readOperation() });
    if (port) { void this.reload(); void this.refreshSupplemental(); }
  }
  public stop() { this.connect(null); this.patch({ draft: null, configuration: null, tokens: null, tokenResult: null }); }
  public edit(edit: (draft: ConfigurationDraftState) => void) {
    if (!this.state.draft || this.state.pending || this.state.loading) return;
    const draft = structuredClone(this.state.draft); edit(draft); this.patch({ draft, status: { kind: 'idle' } });
  }
  public discard() {
    if (this.state.pending || this.state.loading || !this.state.configuration) return;
    this.patch({ draft: snapshotToDraft(this.state.configuration), status: { kind: 'idle' } });
  }
  public async reload(discard = false) {
    const port = this.port; if (!port || this.state.pending) return;
    const epoch = this.epoch; const readId = ++this.readId;
    this.patch({ loading: true });
    try {
      const configuration = await port.read();
      if (!this.current(epoch) || readId !== this.readId) return;
      const dirty = isDraftDirty(this.state.configuration, this.state.draft);
      this.patch({ configuration, draft: !discard && dirty ? this.state.draft : snapshotToDraft(configuration), status: !discard && dirty ? { kind: 'preview', message: '已读取最新配置，保留本地修改；如修订冲突，请丢弃修改后重新编辑。' } : { kind: 'idle' } });
    } catch (error) { if (this.current(epoch) && readId === this.readId) this.patch({ status: { kind: 'error', message: message(error) } }); }
    finally { if (this.current(epoch) && readId === this.readId) this.patch({ loading: false }); }
  }
  public async submit(preview: boolean) {
    const port = this.port; if (!port || this.state.pending || this.state.loading) return;
    const request = buildUpdateRequest(this.state.configuration, this.state.draft, preview);
    if ('error' in request) { this.patch({ status: { kind: 'error', message: request.error } }); return; }
    const epoch = this.epoch; this.patch({ pending: true, status: { kind: preview ? 'loading' : 'saving', message: preview ? '正在生成变更预览…' : '正在保存并等待应用结果…' } });
    try {
      const result = await (preview ? port.preview(request) : port.save(request));
      if (!this.current(epoch)) return;
      // 冲突不能把新修订与旧草稿自动组合，必须保留用户决定重载的机会。
      const saved = result.status === 'success' && result.snapshot && !preview;
      this.patch({ ...(saved ? { configuration: result.snapshot!, draft: snapshotToDraft(result.snapshot!) } : {}), status: { kind: result.status === 'preview' ? 'preview' : result.status === 'success' && result.apply_state !== 'failed' ? 'success' : 'error', message: result.message || (saved ? '配置已保存' : '配置未保存'), summary: result.change_summary } });
      if (saved) void this.refreshSupplemental();
    } catch (error) { if (this.current(epoch)) this.patch({ status: { kind: 'error', message: message(error) } }); }
    finally { if (this.current(epoch)) this.patch({ pending: false }); }
  }
  public async testProvider(index: number) {
    const port = this.port; if (!port || this.state.pending || this.state.loading) return;
    const provider = toProviderTestDraft(this.state.draft?.providers[index] ?? null); if (!provider) return;
    const epoch = this.epoch; this.patch({ pending: true, status: { kind: 'loading', message: '正在测试连接…' } });
    try {
      const result = await port.testProvider({ request_id: createRequestId('provider-test'), provider });
      if (!this.current(epoch)) return;
      const draft = structuredClone(this.state.draft!);
      if (result.status === 'success') draft.providers[index].models = mergeDiscoveredModels(draft.providers[index].models, result.discovered_models);
      this.patch({ draft, status: { kind: result.status === 'success' ? 'success' : 'error', message: result.message, summary: result.discovered_models.slice(0, 8).map(id => `发现模型 ${id}`) } });
    } catch (error) { if (this.current(epoch)) this.patch({ status: { kind: 'error', message: message(error) } }); }
    finally { if (this.current(epoch)) this.patch({ pending: false }); }
  }
  public async refreshSupplemental() {
    const port = this.port; if (!port) return; const epoch = this.epoch;
    const supplementalId = ++this.supplementalId; const tokenId = this.tokenId;
    const operationVersion = this.operationVersion;
    const current = () => this.current(epoch) && supplementalId === this.supplementalId;
    this.patch({ skillsPending: true });
    await Promise.allSettled([
      port.tokens().then(tokens => { if (current() && tokenId === this.tokenId && !this.state.tokenPending) this.patch({ tokens, tokenError: null }); }).catch(error => { if (current() && tokenId === this.tokenId) this.patch({ tokenError: message(error) }); }),
      port.operations().then(operations => { if (current()) { if (!this.state.operationPending && operationVersion === this.operationVersion) this.patch({ operations, operationsError: null }); const id = this.readOperation(); if (id && !this.polling && !this.timer) { this.patch({ operationPending: true }); void this.poll(id, epoch); } } }).catch(error => { if (current() && operationVersion === this.operationVersion) this.patch({ operationsError: message(error) }); }),
      port.skills().then(skills => { if (current()) this.patch({ skills }); }).catch(error => { if (current()) this.patch({ skills: { request_id: 'read-error', status: 'error', message: message(error) } }); }).finally(() => { if (current()) this.patch({ skillsPending: false }); }),
    ]);
  }
  public async mutateToken(action: 'create' | 'rotate' | 'revoke', value: string) {
    const port = this.port; if (!port || this.state.tokenPending) return; const epoch = this.epoch;
    const revealId = this.tokenRevealId;
    this.tokenId++;
    this.patch({ tokenPending: true, tokenResult: null, tokenError: null });
    try { const result = await port.mutateToken(action, value); if (this.current(epoch)) this.patch({ tokens: result.snapshot, tokenResult: revealId === this.tokenRevealId ? result : null }); }
    catch (error) { if (this.current(epoch)) this.patch({ tokenError: message(error) }); }
    finally { if (this.current(epoch)) this.patch({ tokenPending: false }); }
  }
  public hideToken() { this.tokenRevealId++; this.patch({ tokenResult: null }); }
  public async runOperation(operation: string, backupId?: string) {
    const port = this.port; if (!port || this.state.operationPending) return; const epoch = this.epoch;
    const id = createRequestId('deployment_op');
    this.operationVersion++; this.writeOperation(id); this.patch({ operationPending: true, operationsError: null });
    try { const result = await port.runOperation(operation, { operationId: id, backupId, confirm: true }); if (!this.current(epoch) || this.readOperation() !== id) return; this.projectOperation(result); if (active(result)) void this.poll(id, epoch); }
    catch (error) { if (this.current(epoch) && this.readOperation() === id) { this.patch({ operationsError: `${message(error)}；正在查询原事务结果。` }); void this.poll(id, epoch); } }
  }
  private async poll(id: string, epoch: number, attempt = 0): Promise<void> {
    if (!this.current(epoch) || this.readOperation() !== id || this.polling) return;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.polling = true;
    try { const result = await this.port!.operationResult(id); if (!this.current(epoch) || this.readOperation() !== id) return; if (result) { this.projectOperation(result); if (!active(result)) return; } }
    catch (error) { if (this.current(epoch)) this.patch({ operationsError: message(error) }); }
    finally { if (this.current(epoch)) this.polling = false; }
    if (!this.current(epoch)) return;
    if (attempt >= 599) { this.patch({ operationsError: '事务查询超时，请刷新继续查询原事务。' }); return; }
    this.timer = setTimeout(() => void this.poll(id, epoch, attempt + 1), 1000);
  }
  private projectOperation(result: DeploymentOperationResult) {
    this.operationVersion++;
    this.patch({ operationResult: result, operations: result.snapshot, operationPending: active(result), operationsError: null });
    if (!active(result)) this.writeOperation('');
  }
  private activeOperation = '';
  private readOperation() { try { return globalThis.localStorage?.getItem(operationKey) || this.activeOperation; } catch { return this.activeOperation; } }
  private writeOperation(id: string) { this.activeOperation = id; try { if (id) globalThis.localStorage?.setItem(operationKey, id); else globalThis.localStorage?.removeItem(operationKey); } catch { /* 无存储时仅在当前页面持有 receipt。 */ } }
}
