import React from 'react';
import { Download, PackagePlus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { AudioCapabilityStatus, AudioProviderStatus, AudioStatus } from '../../../../store/appStore';
import { compactProviderMessage, providerLabel, PROVIDER_STATUS_LABELS } from '../../model';
import { useCapabilitiesViewModel, useExtensionsViewModel } from '../../view-models';
import { InfoRows, PageHeader, StatusBadge, SurfaceCard } from '../../shared/ui';

interface CapabilitiesPageProps {
  audioStatus: AudioStatus;
  audioInputStatus: string;
  activeSection: string;
  onOpenAudioSettings: () => void;
}

type CapabilitySourceRuntime = ReturnType<typeof useCapabilitiesViewModel>['providerRuntimes'][number];

export const CapabilitiesPage: React.FC<CapabilitiesPageProps> = ({ audioStatus, audioInputStatus, activeSection, onOpenAudioSettings }) => {
  const capabilities = useCapabilitiesViewModel();
  return (
    <div className="capabilities-workbench page-stack">
      <PageHeader eyebrow="能力" title={capabilitySectionTitle(activeSection)} summary="内置能力、扩展贡献与外部能力来源汇入统一目录；角色只会看到面向角色且通过权限检查的能力。" />
      {activeSection === 'skills' && <SkillsView vm={capabilities} />}
      {activeSection === 'extensions' && <ExtensionsView />}
      {activeSection === 'voice-status' && <VoiceStatusView audioStatus={audioStatus} audioInputStatus={audioInputStatus} onOpenSettings={onOpenAudioSettings} />}
      {activeSection === 'automation' && <AutomationView />}
    </div>
  );
};

const SkillsView: React.FC<{ vm: ReturnType<typeof useCapabilitiesViewModel> }> = ({ vm }) => (
  <div className="capability-directory-layout">
    <section className="capability-directory-summary">
      <span>统一目录</span><h2>{vm.skillCatalog?.totalSkills ?? 0} 项技能</h2>
      <p>{vm.skillCatalog?.totalTools ?? 0} 个工具，{vm.confirmationSkillCount} 项需要用户确认。</p>
    </section>
    <div className="capability-directory-list">
      {vm.skillCatalogState === 'loading' && <p className="muted-copy">正在读取技能目录。</p>}
      {vm.skillCatalogState === 'error' && <p className="error-copy">{vm.skillCatalogMessage}</p>}
      {(vm.skillCatalog?.entries ?? []).map((entry) => (
        <article className="capability-directory-card" key={entry.id}>
          <div><span>{skillProviderLabel(entry.provider.kind)}</span><h3>{entry.name}</h3><p>{entry.description}</p></div>
          <InfoRows rows={[
            ['可用状态', entry.metadata.runtime_status === 'ready' ? '可用' : '仅声明'],
            ['能力资源', `${entry.tools.length} 工具 / ${entry.resources.length} 资源 / ${entry.prompts.length} 提示`],
            ['使用边界', entry.policy.confirmationRequired ? '调用前需要确认' : '可按策略直接调用'],
          ]} />
        </article>
      ))}
    </div>
    {vm.providerRuntimes.length > 0 && (
      <section className="capability-source-section" aria-labelledby="capability-source-title">
        <div className="section-title">
          <h2 id="capability-source-title">能力来源</h2>
          <p>统一目录的内置与可插拔来源；技术标识只在日志和高级诊断中展示。</p>
        </div>
        <div className="capability-source-list">
          {vm.providerRuntimes.map((runtime) => (
            <article className="capability-source-item" key={`${runtime.provider.kind}:${runtime.provider.id}`}>
              <div className="capability-source-copy">
                <span>{skillProviderLabel(runtime.provider.kind)}</span>
                <strong>{capabilitySourceName(runtime)}</strong>
                <p>{capabilitySourceSummary(runtime)}</p>
              </div>
              <div className="capability-source-state">
                <StatusBadge tone={runtime.state === 'ready' ? 'ready' : 'warn'}>{providerRuntimeLabel(runtime.state)}</StatusBadge>
                <em>{runtime.skill_count} 技能 / {runtime.tool_count} 工具</em>
              </div>
            </article>
          ))}
        </div>
      </section>
    )}
  </div>
);

const ExtensionsView: React.FC = () => {
  const vm = useExtensionsViewModel();
  const selected = vm.selected;
  const switchingVersion = Boolean(
    selected?.running
    && vm.selectedVersion
    && vm.selectedVersion !== selected.activeVersion,
  );
  if (vm.loadState === 'loading') return <SurfaceCard><p className="muted-copy">正在读取扩展目录。</p></SurfaceCard>;
  if (vm.loadState === 'error') return <SurfaceCard><p className="error-copy">{vm.message || '扩展目录读取失败。'}</p></SurfaceCard>;

  return (
    <div className="extensions-workbench">
      <ExtensionInstallPanel vm={vm} />
      <div className="extensions-layout">
      <aside className="extension-list-panel surface-card">
        <div className="section-title"><h2>已安装扩展</h2><p>{vm.snapshot?.extensions.length ?? 0} 个</p></div>
        <div className="extension-list">{(vm.snapshot?.extensions ?? []).map((extension) => <button type="button" key={extension.id} aria-current={selected?.id === extension.id ? 'true' : undefined} onClick={() => vm.selectExtension(extension)}><span><strong>{extension.name}</strong><em>{extension.version}</em></span><StatusBadge tone={extension.operationalState === 'ready' ? 'ready' : extension.operationalState === 'error' ? 'error' : 'warn'}>{extensionStateLabel(extension.operationalState)}</StatusBadge></button>)}</div>
      </aside>
      <section className="extension-main-panel">
        {!selected ? <SurfaceCard><p className="muted-copy">没有已安装扩展。</p></SurfaceCard> : <>
          <section className="extension-detail-head"><div><span>扩展</span><h2>{selected.name}</h2><p>{selected.description}</p></div><div className="extension-hero-actions"><select className="extension-version-select" aria-label="扩展版本" value={vm.selectedVersion} onChange={(event) => vm.setSelectedVersion(event.target.value)}>{selected.installedVersions.map((version) => <option value={version} key={version}>{version}{version === selected.activeVersion ? ' · 当前' : ''}</option>)}</select><button type="button" className={selected.running && !switchingVersion ? 'danger-action' : 'primary-action'} disabled={vm.actionState === 'starting' || vm.actionState === 'stopping'} onClick={() => { void (selected.running && !switchingVersion ? vm.stopExtension() : vm.startExtension()); }}>{switchingVersion ? '切换版本' : selected.running ? '关闭' : '启动'}</button><button type="button" className="icon-action danger-action" title="卸载所选版本" aria-label="卸载所选版本" disabled={(selected.running && selected.activeVersion === vm.selectedVersion) || vm.actionState === 'stopping'} onClick={() => { void vm.uninstallSelected(); }}><Trash2 size={16} /></button><button type="button" className="secondary-action" onClick={vm.refresh}>刷新</button></div></section>
          <SurfaceCard title="运行状态"><InfoRows rows={[
            ['状态', extensionStateLabel(selected.operationalState)], ['说明', selected.operationalSummary], ['权限', selected.permissions.length ? selected.permissions.join('、') : '无额外权限'], ['贡献能力', String(vm.contributionCount)],
          ]} />{vm.message && <p className={vm.actionState === 'error' ? 'error-copy' : 'muted-copy'}>{vm.message}</p>}</SurfaceCard>
          {selected.contributions.commands.length > 0 && <SurfaceCard title="可用操作"><div className="extension-command-list">{selected.contributions.commands.map((command) => <button type="button" className="secondary-action" key={command.command} disabled={command.state !== 'enabled' || vm.commandState.status === 'running'} onClick={() => { void vm.runExtensionCommand(command.command); }}>{command.title}</button>)}</div>{vm.commandState.message && <p className={vm.commandState.status === 'error' ? 'error-copy' : 'muted-copy'}>{vm.commandState.message}</p>}</SurfaceCard>}
          <SurfaceCard title="扩展配置" subtitle="通用配置由扩展 Schema 驱动；当前保留结构化 YAML 高级入口">
            <textarea className="extension-config-editor" rows={10} value={vm.configDraft} onChange={(event) => vm.setConfigDraft(event.target.value)} />
            <button type="button" className="primary-action" disabled={!vm.configDirty || vm.actionState === 'saving'} onClick={() => { void vm.saveConfig(); }}>保存扩展配置</button>
          </SurfaceCard>
        </>}
      </section>
      </div>
    </div>
  );
};

const ExtensionInstallPanel: React.FC<{ vm: ReturnType<typeof useExtensionsViewModel> }> = ({ vm }) => {
  const source = vm.installSource;
  const setKind = (kind: 'local_file' | 'release_manifest' | 'registry' | 'repository'): void => {
    if (kind === 'local_file') vm.setInstallSource({ kind });
    if (kind === 'release_manifest') vm.setInstallSource({ kind, url: '' });
    if (kind === 'repository') vm.setInstallSource({ kind, repository: '', tag: '' });
    if (kind === 'registry') vm.setInstallSource({ kind, catalogUrl: '', extensionId: '', channel: 'stable' });
  };
  return <section className="extension-install-panel surface-card" aria-labelledby="extension-install-title">
    <div className="section-title"><div><span>扩展来源</span><h2 id="extension-install-title">安装扩展</h2></div><PackagePlus size={19} aria-hidden="true" /></div>
    <div className="extension-source-tabs" role="tablist" aria-label="扩展安装来源">
      {([['registry', '审核目录'], ['repository', '仓库发布'], ['release_manifest', '发布清单'], ['local_file', '本地包']] as const).map(([kind, label]) => <button type="button" role="tab" aria-selected={source.kind === kind} key={kind} onClick={() => setKind(kind)}>{label}</button>)}
    </div>
    <div className="extension-source-fields">
      {source.kind === 'registry' && <><label>目录地址<input value={source.catalogUrl} placeholder="https://.../catalog.json" onChange={(event) => vm.setInstallSource({ ...source, catalogUrl: event.target.value })} /></label><label>扩展 ID<input value={source.extensionId} placeholder="publisher.extension" onChange={(event) => vm.setInstallSource({ ...source, extensionId: event.target.value })} /></label><label>通道<select value={source.channel} onChange={(event) => vm.setInstallSource({ ...source, channel: event.target.value as 'stable' | 'beta' | 'nightly' })}><option value="stable">Stable</option><option value="beta">Beta</option><option value="nightly">Nightly</option></select></label></>}
      {source.kind === 'repository' && <><label>仓库地址<input value={source.repository} placeholder="https://github.com/owner/repository" onChange={(event) => vm.setInstallSource({ ...source, repository: event.target.value })} /></label><label>版本标签<input value={source.tag} placeholder="v1.0.0" onChange={(event) => vm.setInstallSource({ ...source, tag: event.target.value })} /></label></>}
      {source.kind === 'release_manifest' && <label>发布清单地址<input value={source.url} placeholder="https://.../release-manifest.json" onChange={(event) => vm.setInstallSource({ ...source, url: event.target.value })} /></label>}
      {source.kind === 'local_file' && <p className="muted-copy">选择本机 `.gcex` 扩展包。文件路径不会暴露给页面。</p>}
      <button type="button" className="primary-action extension-prepare-action" disabled={vm.installState === 'preparing' || vm.installState === 'installing'} onClick={() => { void vm.prepareInstall(); }}><Download size={16} />{source.kind === 'local_file' ? '选择并检查' : '检查来源'}</button>
    </div>
    {vm.installPreview?.status === 'ready' && vm.installPreview.extension && vm.installPreview.artifact && vm.installPreview.trust && <div className="extension-install-confirmation" role="alertdialog" aria-modal="false" aria-labelledby="extension-confirm-title">
      <div className="extension-confirm-head"><ShieldCheck size={20} /><div><span>安装确认</span><h3 id="extension-confirm-title">{vm.installPreview.extension.name} {vm.installPreview.extension.version}</h3></div><button type="button" className="icon-action" title="取消安装" aria-label="取消安装" onClick={() => { void vm.cancelInstall(); }}><X size={16} /></button></div>
      <InfoRows rows={[
        ['发布者', vm.installPreview.extension.publisher],
        ['权限', vm.installPreview.extension.permissions.length ? vm.installPreview.extension.permissions.join('、') : '无额外权限'],
        ['适用平台', vm.installPreview.extension.platforms.join('、')],
        ['制品摘要', `${vm.installPreview.artifact.sha256.slice(0, 16)}...`],
        ['目录审核', vm.installPreview.trust.listing_reviewed ? '已审核' : '未审核'],
        ['发布者验证', vm.installPreview.trust.publisher_verified ? '已验证' : '未验证'],
        ['制品签名', vm.installPreview.trust.artifact_signed ? '已验证' : '未验证'],
        ['构建证明', vm.installPreview.trust.build_attested ? '已验证' : '未验证'],
      ]} />
      <div className="extension-confirm-actions"><button type="button" className="secondary-action" onClick={() => { void vm.cancelInstall(); }}>取消</button><button type="button" className="primary-action" disabled={vm.installState === 'installing'} onClick={() => { void vm.commitInstall(); }}>确认权限并安装</button></div>
    </div>}
  </section>;
};

const VoiceStatusView: React.FC<{ audioStatus: AudioStatus; audioInputStatus: string; onOpenSettings: () => void }> = ({ audioStatus, audioInputStatus, onOpenSettings }) => (
  <div className="voice-control-grid">
    <AudioLane title="语音生成" capability={audioStatus.tts} />
    <AudioLane title="语音识别" capability={audioStatus.asr} />
    <SurfaceCard title="当前输入"><InfoRows rows={[["录音与识别", audioInputStatusLabel(audioInputStatus)], ['配置入口', '设置 / 语音服务']]} /><button type="button" className="secondary-action" onClick={onOpenSettings}>管理语音服务</button></SurfaceCard>
  </div>
);

const AudioLane: React.FC<{ title: string; capability: AudioCapabilityStatus }> = ({ title, capability }) => (
  <SurfaceCard title={title} subtitle={capability.enabled ? `当前路由：${capability.activeProvider ? providerLabel(capability.activeProvider) : '等待就绪'}` : '已在设置中关闭'}>
    <div className="audio-provider-list">{capability.providers.map((provider) => <AudioProvider key={provider.provider_id} provider={provider} />)}</div>
    {capability.enabled && capability.providers.length === 0 && <p className="muted-copy">等待服务上报状态。</p>}
  </SurfaceCard>
);

const AudioProvider: React.FC<{ provider: AudioProviderStatus }> = ({ provider }) => (
  <div className="audio-provider"><div className="provider-body"><strong>{providerLabel(provider.provider_id)}</strong><span className="provider-message">{provider.message ? compactProviderMessage(provider.message) : `${provider.role === 'primary' ? '主路由' : '兜底'} / ${provider.execution === 'cloud' ? '云端' : '本地'}`}</span></div><StatusBadge tone={provider.status === 'ready' ? 'ready' : provider.status === 'unavailable' ? 'error' : 'warn'}>{PROVIDER_STATUS_LABELS[provider.status]}</StatusBadge></div>
);

const AutomationView: React.FC = () => <div className="capability-empty-state"><span>自动化</span><h2>尚未启用自动化工作流</h2><p>Scheduler Catalog 接入后，扩展可以贡献计划、触发器和可审计执行记录。</p></div>;

function capabilitySectionTitle(section: string): string { return ({ skills: '技能', extensions: '扩展', 'voice-status': '语音服务', automation: '自动化' } as Record<string, string>)[section] ?? '能力'; }
function skillProviderLabel(kind: string): string { return ({ core: '内置', extension: '扩展', mcp_server: 'MCP', user: '用户' } as Record<string, string>)[kind] ?? kind; }
function capabilitySourceName(runtime: CapabilitySourceRuntime): string {
  if (runtime.provider.kind === 'core') return '摇篮内置能力';
  return runtime.display_name || runtime.provider.id;
}
function capabilitySourceSummary(runtime: CapabilitySourceRuntime): string {
  if (runtime.provider.kind === 'core') {
    return runtime.state === 'ready'
      ? 'Kernel 内置技能与工具已接入统一能力目录。'
      : '部分内置能力仍只有契约，尚未接入对应平台服务。';
  }
  return ({
    ready: '能力来源已连接并可用。',
    contract_only: '能力契约已登记，当前没有可执行承载。',
    connecting: '正在连接并读取能力目录。',
    degraded: '能力来源可用，但部分功能处于降级状态。',
    unavailable: '能力来源当前不可用。',
    stopped: '能力来源已停止。',
  } as Record<string, string>)[runtime.state] ?? runtime.summary;
}
function providerRuntimeLabel(state: string): string { return ({ ready: '已就绪', contract_only: '仅声明', connecting: '连接中', degraded: '降级', unavailable: '不可用', stopped: '已停止' } as Record<string, string>)[state] ?? state; }
function extensionStateLabel(state: string): string { return ({ disabled: '已关闭', stopped: '待启动', ready: '可用', degraded: '上游未就绪', error: '错误' } as Record<string, string>)[state] ?? state; }
function audioInputStatusLabel(state: string): string { return ({ recording: '录音中', recognizing: '识别中', error: '异常', idle: '空闲' } as Record<string, string>)[state] ?? state; }
