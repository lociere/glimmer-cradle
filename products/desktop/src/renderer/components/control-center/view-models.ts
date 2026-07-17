import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolvePublicAssetUrl } from '../../avatar/public-assets';
import type { AudioStatus, AvatarAppearanceState } from '../../store/appStore';

type AvatarDiagnosticsSnapshot = Awaited<ReturnType<Window['desktopHost']['getAvatarDiagnostics']>>;
type AvatarPackageCatalogSnapshot = Awaited<ReturnType<Window['desktopHost']['getAvatarPackageCatalog']>>;
type AvatarPackageSnapshot = AvatarPackageCatalogSnapshot['packages'][number];
type AvatarManualAction = Awaited<ReturnType<Window['desktopHost']['getAvatarManualActions']>>[number];
type AvatarActionState = Awaited<ReturnType<Window['desktopHost']['getAvatarActionState']>>;
type CharacterPresentationProjection = Awaited<ReturnType<Window['desktopHost']['getCharacterPresentationProjection']>>;
type RuntimeReadinessCatalog = Awaited<ReturnType<Window['desktopHost']['getRuntimeReadiness']>>;
type RuntimeReadinessSnapshot = NonNullable<RuntimeReadinessCatalog>['runtimes'][number];
type ExtensionManagementSnapshot = Awaited<ReturnType<Window['desktopHost']['getExtensions']>>;
type ExtensionManagementItem = ExtensionManagementSnapshot['extensions'][number];
type ExtensionInstallPreview = Awaited<ReturnType<Window['desktopHost']['prepareExtensionInstall']>>;
type ExtensionInstallSourceInput = Parameters<Window['desktopHost']['prepareExtensionInstall']>[0];
type SkillCatalogResponse = Awaited<ReturnType<Window['desktopHost']['getSkillCatalog']>>;
type SkillCatalogSnapshot = NonNullable<SkillCatalogResponse['snapshot']>;
type SkillCatalogEntrySnapshot = SkillCatalogSnapshot['entries'][number];
type SkillProviderRuntimeSnapshot = SkillCatalogSnapshot['providerRuntimes'][number];

export interface CapabilitiesViewModel {
  readonly skillCatalog: SkillCatalogSnapshot | null;
  readonly skillCatalogState: 'loading' | 'ready' | 'error';
  readonly skillCatalogMessage: string;
  readonly readySkillEntries: readonly SkillCatalogEntrySnapshot[];
  readonly providerRuntimes: readonly SkillProviderRuntimeSnapshot[];
  readonly confirmationSkillCount: number;
}

export interface AvatarPageViewModel {
  readonly diagnostics: AvatarDiagnosticsSnapshot | null;
  readonly diagnosticsState: 'loading' | 'ready' | 'error';
  readonly avatarRuntime: RuntimeReadinessSnapshot | null;
  readonly selectedModel: AvatarPackageSnapshot | null;
  readonly placementResetState: 'idle' | 'pending' | 'success' | 'error';
  readonly manualActions: readonly AvatarManualAction[];
  readonly avatarActionState: AvatarActionState;
  readonly pendingActionId: string;
  readonly actionError: string;
  readonly activeActionIds: ReadonlySet<string>;
  readonly actionLabels: ReadonlyMap<string, string>;
  readonly actionGroups: readonly [string, AvatarManualAction[]][];
  readonly avatarPresentation: AvatarPackageSnapshot['presentation'] | undefined;
  readonly placementSummary: string;
  readonly placementPresets: Record<string, unknown>;
  readonly activePlacementId: string;
  readonly shellTone: 'ready' | 'warn';
  readonly diagnosticsTone: AvatarDiagnosticsSnapshot['tone'] | 'warn';
  readonly diagnosticsSummary: string;
  readonly avatarImage: string;
  readonly refreshDiagnostics: () => void;
  readonly setPlacementResetState: React.Dispatch<React.SetStateAction<'idle' | 'pending' | 'success' | 'error'>>;
  readonly setPendingActionId: React.Dispatch<React.SetStateAction<string>>;
  readonly setActionError: React.Dispatch<React.SetStateAction<string>>;
  readonly setAvatarActionState: React.Dispatch<React.SetStateAction<AvatarActionState>>;
}

export interface ExtensionsViewModel {
  readonly snapshot: ExtensionManagementSnapshot | null;
  readonly selected: ExtensionManagementItem | null;
  readonly selectedId: string;
  readonly selectedVersion: string;
  readonly configDraft: string;
  readonly loadState: 'loading' | 'ready' | 'error';
  readonly actionState: 'idle' | 'saving' | 'starting' | 'stopping' | 'error' | 'success';
  readonly message: string;
  readonly commandState: {
    commandId: string;
    status: 'idle' | 'running' | 'success' | 'error';
    message: string;
  };
  readonly configDirty: boolean;
  readonly contributionCount: number;
  readonly installSource: ExtensionInstallSourceInput;
  readonly installPreview: ExtensionInstallPreview | null;
  readonly installState: 'idle' | 'preparing' | 'confirming' | 'installing' | 'error' | 'success';
  readonly setInstallSource: React.Dispatch<React.SetStateAction<ExtensionInstallSourceInput>>;
  readonly prepareInstall: () => Promise<void>;
  readonly commitInstall: () => Promise<void>;
  readonly cancelInstall: () => Promise<void>;
  readonly uninstallSelected: () => Promise<void>;
  readonly refresh: () => void;
  readonly selectExtension: (extension: ExtensionManagementItem) => void;
  readonly setSelectedVersion: React.Dispatch<React.SetStateAction<string>>;
  readonly setConfigDraft: React.Dispatch<React.SetStateAction<string>>;
  readonly setActionState: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'starting' | 'stopping' | 'error' | 'success'>>;
  readonly setMessage: React.Dispatch<React.SetStateAction<string>>;
  readonly runExtensionCommand: (commandId: string) => Promise<void>;
  readonly saveConfig: () => Promise<void>;
  readonly startExtension: () => Promise<void>;
  readonly stopExtension: () => Promise<void>;
}

export function useCapabilitiesViewModel(): CapabilitiesViewModel {
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalogSnapshot | null>(null);
  const [skillCatalogState, setSkillCatalogState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [skillCatalogMessage, setSkillCatalogMessage] = useState('');

  const refresh = useCallback((): void => {
    setSkillCatalogState('loading');
    void window.desktopHost.getSkillCatalog()
      .then((response) => {
        if (response.status === 'success' && response.snapshot) {
          setSkillCatalog(response.snapshot);
          setSkillCatalogState('ready');
          setSkillCatalogMessage('');
          return;
        }
        setSkillCatalog(null);
        setSkillCatalogState('error');
        setSkillCatalogMessage(response.message || '无法读取技能。');
      })
      .catch((error) => {
        setSkillCatalog(null);
        setSkillCatalogState('error');
        setSkillCatalogMessage(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    refresh();
    return window.desktopHost.onExtensionStatusChanged(() => {
      refresh();
    });
  }, [refresh]);

  const readySkillEntries = useMemo(
    () => (skillCatalog?.entries ?? []).filter((entry) => entry.metadata.runtime_status === 'ready'),
    [skillCatalog],
  );
  const providerRuntimes = useMemo(
    () => skillCatalog?.providerRuntimes ?? [],
    [skillCatalog],
  );
  const confirmationSkillCount = useMemo(
    () => (skillCatalog?.entries ?? []).filter((entry) => entry.policy.confirmationRequired).length,
    [skillCatalog],
  );

  return {
    skillCatalog,
    skillCatalogState,
    skillCatalogMessage,
    readySkillEntries,
    providerRuntimes,
    confirmationSkillCount,
  };
}

export function useAvatarPageViewModel(
  currentAvatarModel: string,
  appearance: AvatarAppearanceState,
  presentationProjection: CharacterPresentationProjection | null,
  runtimeReadinessCatalog: RuntimeReadinessCatalog | null,
): AvatarPageViewModel {
  const [diagnostics, setDiagnostics] = useState<AvatarDiagnosticsSnapshot | null>(null);
  const [diagnosticsState, setDiagnosticsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedModel, setSelectedModel] = useState<AvatarPackageSnapshot | null>(null);
  const [placementResetState, setPlacementResetState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [manualActions, setManualActions] = useState<AvatarManualAction[]>([]);
  const [avatarActionState, setAvatarActionState] = useState<AvatarActionState>({ activeActionIds: [] });
  const [pendingActionId, setPendingActionId] = useState('');
  const [actionError, setActionError] = useState('');

  const refreshDiagnostics = useCallback((): void => {
    setDiagnosticsState('loading');
    void window.desktopHost.getAvatarDiagnostics()
      .then((snapshot) => {
        setDiagnostics(snapshot);
        setDiagnosticsState('ready');
      })
      .catch(() => {
        setDiagnostics(null);
        setDiagnosticsState('error');
      });
  }, []);

  useEffect(() => {
    refreshDiagnostics();
  }, [refreshDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    void window.desktopHost.getAvatarPackageCatalog()
      .then((registry) => {
        if (!cancelled) {
          setSelectedModel(
            registry.packages.find((item) => item.modelId === (currentAvatarModel || registry.defaultModelId)) ?? null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedModel(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentAvatarModel]);

  const avatarRuntime = useMemo(
    () => runtimeReadinessCatalog?.runtimes.find((runtime) => runtime.runtime_id === 'avatar.host') ?? null,
    [runtimeReadinessCatalog],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.desktopHost.getAvatarManualActions(),
      window.desktopHost.getAvatarActionState(),
    ])
      .then(([actions, state]) => {
        if (!cancelled) {
          setManualActions(actions);
          setAvatarActionState(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManualActions([]);
          setAvatarActionState({ activeActionIds: [] });
        }
      });
    const unsubscribe = window.desktopHost.onAvatarActionState((state) => {
      if (cancelled) return;
      setAvatarActionState(state);
      setPendingActionId('');
      setActionError(state.state === 'rejected' ? state.message ?? '动作未能执行' : '');
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentAvatarModel]);

  const activeActionIds = useMemo(
    () => new Set(avatarActionState.activeActionIds),
    [avatarActionState.activeActionIds],
  );
  const actionLabels = useMemo(
    () => new Map(manualActions.map((action) => [action.id, action.label])),
    [manualActions],
  );
  const actionGroups = useMemo(() => {
    const groups = new Map<string, AvatarManualAction[]>();
    for (const action of manualActions) {
      const actions = groups.get(action.category) ?? [];
      actions.push(action);
      groups.set(action.category, actions);
    }
    return [...groups.entries()];
  }, [manualActions]);

  const avatarPresentation = selectedModel?.presentation;
  const placementSummary = useMemo(() => {
    if (!avatarPresentation) {
      return '完整形象';
    }
    const labels: Record<string, string> = {
      bust: '半身驻留',
      'three-quarter': '大半身',
      'full-body': '完整形象',
    };
    const placementId = appearance.placementId || avatarPresentation.defaultPlacement;
    return labels[placementId] ?? placementId;
  }, [appearance.placementId, avatarPresentation]);
  const placementPresets = avatarPresentation?.placementPresets ?? {};
  const activePlacementId = appearance.placementId
    || avatarPresentation?.defaultPlacement
    || '';
  const shellTone: 'ready' | 'warn' = avatarRuntime?.state === 'ready' || presentationProjection?.lifecycle.ready
    ? 'ready'
    : 'warn';
  const diagnosticsTone = avatarRuntime?.state === 'failed'
    ? 'error'
    : avatarRuntime?.state === 'degraded'
      ? 'warn'
      : diagnostics?.tone ?? 'warn';
  const diagnosticsSummary = avatarRuntime?.summary
    ?? (diagnosticsState === 'loading'
      ? '正在读取 Avatar 状态'
      : diagnosticsState === 'error'
        ? 'Avatar 诊断读取失败'
        : diagnostics?.summary ?? '等待 Avatar 状态');
  const avatarImage = selectedModel?.previewImagePath
    ? resolvePublicAssetUrl(selectedModel.previewImagePath)
    : '';

  return {
    diagnostics,
    diagnosticsState,
    avatarRuntime,
    selectedModel,
    placementResetState,
    manualActions,
    avatarActionState,
    pendingActionId,
    actionError,
    activeActionIds,
    actionLabels,
    actionGroups,
    avatarPresentation,
    placementSummary,
    placementPresets,
    activePlacementId,
    shellTone,
    diagnosticsTone,
    diagnosticsSummary,
    avatarImage,
    refreshDiagnostics,
    setPlacementResetState,
    setPendingActionId,
    setActionError,
    setAvatarActionState,
  };
}

export function useExtensionsViewModel(): ExtensionsViewModel {
  const [snapshot, setSnapshot] = useState<ExtensionManagementSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [configDraft, setConfigDraft] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [actionState, setActionState] = useState<'idle' | 'saving' | 'starting' | 'stopping' | 'error' | 'success'>('idle');
  const [message, setMessage] = useState('');
  const [installSource, setInstallSource] = useState<ExtensionInstallSourceInput>({ kind: 'local_file' });
  const [installPreview, setInstallPreview] = useState<ExtensionInstallPreview | null>(null);
  const [installState, setInstallState] = useState<ExtensionsViewModel['installState']>('idle');
  const [commandState, setCommandState] = useState<{
    commandId: string;
    status: 'idle' | 'running' | 'success' | 'error';
    message: string;
  }>({ commandId: '', status: 'idle', message: '' });

  const applySnapshot = useCallback((next: ExtensionManagementSnapshot): void => {
    setSnapshot(next);
    const nextSelected = next.extensions.find((extension) => extension.id === selectedId)
      ?? next.extensions[0]
      ?? null;
    setSelectedId(nextSelected?.id ?? '');
    setSelectedVersion((current) => nextSelected?.installedVersions.includes(current)
      ? current
      : nextSelected?.activeVersion || nextSelected?.version || '');
    setConfigDraft(nextSelected?.configYaml ?? '');
  }, [selectedId]);

  const refresh = useCallback((): void => {
    setLoadState('loading');
    void window.desktopHost.getExtensions()
      .then((next) => {
        setSnapshot(next);
        setLoadState('ready');
        const nextSelectedId = selectedId || next.extensions[0]?.id || '';
        setSelectedId(nextSelectedId);
        const selected = next.extensions.find((extension) => extension.id === nextSelectedId) ?? next.extensions[0];
        setSelectedVersion((current) => selected?.installedVersions.includes(current)
          ? current
          : selected?.activeVersion || selected?.version || '');
        setConfigDraft(selected?.configYaml ?? '');
      })
      .catch((error) => {
        setLoadState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      });
  }, [selectedId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => (
    window.desktopHost.onExtensionStatusChanged(() => {
      void window.desktopHost.getExtensions()
        .then((next) => applySnapshot(next))
        .catch(() => undefined);
    })
  ), [applySnapshot]);

  const selected = useMemo(() => (
    snapshot?.extensions.find((extension) => extension.id === selectedId) ?? snapshot?.extensions[0] ?? null
  ), [selectedId, snapshot]);
  const configDirty = Boolean(selected && configDraft !== selected.configYaml);
  const contributionCount = selected
    ? selected.contributions.commands.length
      + selected.contributions.settings.length
      + selected.contributions.skills.length
      + selected.contributions.views.length
    : 0;

  const runExtensionCommand = useCallback(async (commandId: string): Promise<void> => {
    if (!selected) return;
    setCommandState({ commandId, status: 'running', message: '' });
    try {
      const response = await window.desktopHost.executeExtensionCommand({ commandId, args: [] });
      const message = response.message || formatCommandResult(response.result);
      setCommandState({
        commandId,
        status: response.status === 'error' ? 'error' : 'success',
        message: message || '命令已执行。',
      });
      void window.desktopHost.getExtensions()
        .then((next) => applySnapshot(next))
        .catch(() => undefined);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      setCommandState({ commandId, status: 'error', message: normalizeExtensionCommandError(rawMessage) });
    }
  }, [applySnapshot, selected]);

  const selectExtension = useCallback((extension: ExtensionManagementItem): void => {
    setSelectedId(extension.id);
    setSelectedVersion(extension.activeVersion || extension.version || extension.installedVersions[0] || '');
    setConfigDraft(extension.configYaml);
    setActionState('idle');
    setMessage('');
    setCommandState({ commandId: '', status: 'idle', message: '' });
  }, []);

  const saveConfig = useCallback(async (): Promise<void> => {
    if (!selected) return;
    setActionState('saving');
    setMessage('');
    try {
      const next = await window.desktopHost.saveExtensionConfig({
        extensionId: selected.id,
        configYaml: configDraft,
      });
      applySnapshot(next);
      setActionState('success');
      setMessage('扩展配置已保存。运行中的扩展可能需要重新启动后读取新配置。');
    } catch (error) {
      setActionState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [applySnapshot, configDraft, selected]);

  const startExtension = useCallback(async (): Promise<void> => {
    if (!selected) return;
    setActionState('starting');
    setMessage('');
    try {
      await window.desktopHost.requestExtensionLifecycle({
        extensionId: selected.id,
        version: selectedVersion || selected.version,
        operation: 'start',
      });
      const next = await window.desktopHost.getExtensions();
      applySnapshot(next);
      setActionState('success');
      setMessage('启动请求已完成。');
    } catch (error) {
      setActionState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [applySnapshot, selected, selectedVersion]);

  const stopExtension = useCallback(async (): Promise<void> => {
    if (!selected) return;
    setActionState('stopping');
    setMessage('');
    try {
      await window.desktopHost.requestExtensionLifecycle({ extensionId: selected.id, operation: 'stop' });
      const next = await window.desktopHost.getExtensions();
      applySnapshot(next);
      setActionState('success');
      setMessage('扩展已关闭，并已从下次自动启动列表移除。');
    } catch (error) {
      setActionState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [applySnapshot, selected]);

  const prepareInstall = useCallback(async (): Promise<void> => {
    setInstallState('preparing');
    setInstallPreview(null);
    setMessage('');
    try {
      const preview = await window.desktopHost.prepareExtensionInstall(installSource);
      setInstallPreview(preview);
      if (preview.status === 'ready') {
        setInstallState('confirming');
      } else {
        setInstallState(preview.message === '已取消选择扩展包' ? 'idle' : 'error');
        setMessage(preview.message || '无法读取扩展包。');
      }
    } catch (error) {
      setInstallState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [installSource]);

  const commitInstall = useCallback(async (): Promise<void> => {
    if (!installPreview?.transaction_id || !installPreview.extension) return;
    setInstallState('installing');
    setMessage('');
    try {
      const result = await window.desktopHost.commitExtensionInstall({
        transactionId: installPreview.transaction_id,
        approvedPermissions: installPreview.extension.permissions,
      });
      if (result.status !== 'success') throw new Error(result.message || '扩展安装失败。');
      setInstallPreview(null);
      setInstallState('success');
      setMessage(result.already_installed ? '该版本已经安装。' : '扩展安装完成。');
      const next = await window.desktopHost.getExtensions();
      setSnapshot(next);
      setSelectedId(result.extension_id ?? '');
      setSelectedVersion(result.version ?? '');
      setConfigDraft(next.extensions.find((extension) => extension.id === result.extension_id)?.configYaml ?? '');
    } catch (error) {
      setInstallState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [installPreview]);

  const cancelInstall = useCallback(async (): Promise<void> => {
    if (installPreview?.transaction_id) {
      await window.desktopHost.cancelExtensionInstall({ transactionId: installPreview.transaction_id }).catch(() => undefined);
    }
    setInstallPreview(null);
    setInstallState('idle');
  }, [installPreview]);

  const uninstallSelected = useCallback(async (): Promise<void> => {
    const version = selectedVersion || selected?.version || '';
    if (!selected || (selected.running && selected.activeVersion === version)) return;
    setActionState('stopping');
    setMessage('');
    try {
      const result = await window.desktopHost.uninstallExtension({
        extensionId: selected.id,
        version: selectedVersion || selected.version,
      });
      if (result.status !== 'success') throw new Error(result.message || '扩展卸载失败。');
      const next = await window.desktopHost.getExtensions();
      const remaining = next.extensions.find((extension) => extension.id === selected.id)
        ?? next.extensions[0]
        ?? null;
      setSnapshot(next);
      setSelectedId(remaining?.id ?? '');
      setSelectedVersion(remaining?.activeVersion || remaining?.version || remaining?.installedVersions[0] || '');
      setConfigDraft(remaining?.configYaml ?? '');
      setActionState('success');
      setMessage('所选扩展版本已卸载。');
    } catch (error) {
      setActionState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [selected, selectedVersion]);

  return {
    snapshot,
    selected,
    selectedId,
    selectedVersion,
    configDraft,
    loadState,
    actionState,
    message,
    commandState,
    configDirty,
    contributionCount,
    installSource,
    installPreview,
    installState,
    setInstallSource,
    prepareInstall,
    commitInstall,
    cancelInstall,
    uninstallSelected,
    refresh,
    selectExtension,
    setSelectedVersion,
    setConfigDraft,
    setActionState,
    setMessage,
    runExtensionCommand,
    saveConfig,
    startExtension,
    stopExtension,
  };
}

function normalizeExtensionCommandError(message: string): string {
  if (message.includes('Kernel 连接已断开') || message.includes('Kernel 尚未连接')) {
    return 'Kernel 未连接，当前无法执行扩展命令。';
  }
  return message;
}

function formatCommandResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const payload = result as Record<string, unknown>;
    if (typeof payload.url === 'string' && payload.url) {
      return `已打开 ${payload.url}`;
    }
    if (payload.ok === true) {
      return '命令执行成功。';
    }
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return '命令已执行。';
    }
  }
  return String(result);
}
