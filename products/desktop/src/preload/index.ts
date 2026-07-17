import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChannelReplyMessage,
  CharacterPresentationProjectionPayload,
  ExtensionInstallPreview,
  ExtensionInstallResult,
  ExtensionUninstallResult,
  RuntimeReadinessCatalog,
  SkillCatalogSnapshot,
} from '@glimmer-cradle/protocol';

export interface ReplyPayload {
  trace_id: string;
  text: string;
  messages: ChannelReplyMessage[];
}

export interface EmotionStatePayload {
  emotion_type: string;
  intensity: number;
  trigger: string;
  timestamp: string;
}

export interface ThoughtStatePayload {
  trace_id: string;
  active: boolean;
  hint: string;
  timestamp: string;
}

/**
 * renderer 上行的文字感知载荷。
 *
 * Kernel 会统一标记为 `source: 'desktop-ui:user'`；renderer 不负责区分子来源。
 * 如果后续需要子来源，新增显式 discriminator 字段，不恢复自由字符串 source。
 */
export interface ClientPerceptionEvent {
  content: string;
}

export interface ConnectionStatus {
  status: 'connecting' | 'online' | 'offline';
}

/** Renderer 本地对 Avatar 呈现状态的轻量投影。 */
export type AvatarRenderState = 'unity-pending' | 'unity';

/**
 * Kernel 上报的 Avatar Host 状态。
 *
 * `unity-pending` 是 renderer 本地等待状态，不通过 IPC 从 Kernel 下发。
 */
export type AvatarStatusKind = 'unity' | 'offline';

export interface AvatarStatus {
  hostKind: AvatarStatusKind;
}

export interface AvatarSdkDiagnosticsSnapshot {
  id: string;
  displayName: string;
  modelFormats: string[];
  status: string;
  sourcePath: string;
  sourceEnv?: string;
  sourceEnvValue?: string;
  resolvedSourcePath: string;
  targetPath: string;
  installed: boolean;
  artifactCount: number;
  installHint: string;
  licenseNote: string;
}

export interface AvatarDiagnosticsSnapshot {
  enabled: boolean;
  launchMode: string;
  command: string;
  cwd: string;
  commandPath: string;
  commandExists: boolean;
  unityProjectPath: string;
  avatarPackageDir: string;
  avatarSdkPackageDir: string;
  assetRegistryPath: string;
  assetRegistryExists: boolean;
  buildLogPath: string;
  processLogPath: string;
  requiredSdks: AvatarSdkDiagnosticsSnapshot[];
  tone: 'ready' | 'warn' | 'error';
  summary: string;
  nextAction: string;
}

export interface AvatarPackageSnapshot {
  id: string;
  default: boolean;
  characterId: string;
  modelId: string;
  displayName: string;
  kind: 'live2d';
  preferredBackend: 'unity';
  previewImagePath?: string;
  live2dVersion: 'cubism4' | 'cubism5';
  presentation?: {
    defaultPlacement: string;
    placementPresets: Record<string, {
      visibleRatio: number;
      rightInset?: number;
      bottomInset?: number;
    }>;
  };
  scaleFactor?: number;
  license?: string;
}

export interface AvatarPackageCatalogSnapshot {
  defaultAvatarPackageId: string;
  defaultModelId: string;
  packages: AvatarPackageSnapshot[];
}

/**
 * Kernel 下发的音频播放请求。
 *
 * `audio_uri` 和 `audio_data` 可同时存在；renderer 优先使用内联数据，避免
 * Windows file URL、Vite 与 Electron 安全策略之间的路径差异。
 */
export interface AudioPlayPayload {
  trace_id: string;
  audio_id: string;
  audio_uri?: string;
  audio_data?: string;
  mime_type?: string;
  duration_ms?: number;
}

export interface AudioInputPayload {
  trace_id?: string;
  audio_id: string;
  audio_data: string;
  mime_type: string;
  duration_ms?: number;
  sample_rate?: number;
}

export interface AudioTranscriptPayload {
  trace_id: string;
  audio_id: string;
  status: 'success' | 'error';
  text?: string;
  message?: string;
}

export interface AudioProviderStatusPayload {
  provider_id: string;
  role: 'primary' | 'fallback';
  execution: 'cloud' | 'local';
  status: 'ready' | 'degraded' | 'unavailable' | 'circuit_open' | 'unknown';
  message?: string;
}

export interface AudioCapabilityStatusPayload {
  enabled: boolean;
  disabled_reason?: string;
  active_provider?: string;
  route_state: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  providers: AudioProviderStatusPayload[];
}

export interface AudioStatusPayload {
  updated_at: number;
  tts: AudioCapabilityStatusPayload;
  asr: AudioCapabilityStatusPayload;
}

export interface ControlCenterSettingsSnapshot {
  inference: {
    maxTokens: number;
    temperature: number;
    topP: number;
  };
  lifeClock: {
    heartbeatEnabled: boolean;
    heartbeatIntervalMs: number;
    focusDurationMs: number;
    ingressDebounceMs: number;
    focusOnAnyChat: boolean;
    summonKeywords: string[];
  };
  embedding: {
    enabled: boolean;
    provider: string;
    cloudModel: string;
    dimensions: number;
    autoDownload: boolean;
    device: string;
    modelPath: string;
    modelId: string;
  };
  modelServices: {
    activeProviderId: string;
    providers: Array<{
      id: string;
      apiType: string;
      baseUrl: string;
      temperature: number;
      models: { chat: string; reasoner: string; vision: string; audio: string };
    }>;
  };
  persona: {
    nickname: string;
    personaMode: string;
  };
  surfaces: Record<string, never>;
  avatar: {
    enabled: boolean;
  };
  audio: {
    ttsEnabled: boolean;
    asrEnabled: boolean;
    cloudVoiceId: string;
  };
}

export interface MemoryArchitectureItem {
  id: string;
  source: 'conversation_message' | 'experience_moment' | 'memory_revision' | 'role_knowledge';
  title: string;
  body: string;
  timestamp?: string;
}

export interface MemoryArchitectureMetrics {
  previewItems: number;
  conversationMessages: number;
  experienceMoments: number;
  episodes: number;
  pendingConsolidationEpisodes: number;
  completedConsolidations: number;
  emptyConsolidations: number;
  failedConsolidations: number;
  activeMemories: number;
  memoryRevisions: number;
  memoryEvidenceLinks: number;
  knowledgeEntries: number;
  durableRecords: number;
  previewedMemories: number;
  sourceNotes: string[];
}

export interface MemoryArchitectureSnapshot {
  updatedAt: number;
  items: MemoryArchitectureItem[];
  metrics: MemoryArchitectureMetrics;
}

export interface SaveControlCenterSettingsResult {
  status: 'saved';
  message: string;
}

export interface ExtensionDependencyHealthSnapshot {
  state: 'ready' | 'unavailable' | 'unknown' | 'not_checked';
  label: string;
  summary: string;
  endpoint?: string;
  checkedAt: number;
}

export interface ExtensionDependencySnapshot {
  id: string;
  displayName: string;
  kind: string;
  required: boolean;
  description: string;
  installDir: string;
  resolvedInstallDir: string;
  tone: 'ready' | 'missing' | 'optional';
  health: ExtensionDependencyHealthSnapshot;
}

export interface ExtensionLogState {
  lastEvent: 'loaded' | 'started' | 'stopped' | 'error' | 'unknown';
  message: string;
  timestamp: string;
}

export interface ExtensionCommandContribution {
  command: string;
  title: string;
  category: string;
  state: 'enabled' | 'disabled' | 'hidden' | 'unsupported';
  disabledReason?: string;
}

export interface ExtensionSettingContribution {
  key: string;
  title: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown';
  defaultValue?: unknown;
}

export interface ExtensionSkillContribution {
  id: string;
  name: string;
  description: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  riskLevel: string;
  confirmationRequired: boolean;
}

export interface ExtensionViewContribution {
  id: string;
  title: string;
  when: string;
}

export interface ExtensionContributionSnapshot {
  commands: ExtensionCommandContribution[];
  settings: ExtensionSettingContribution[];
  skills: ExtensionSkillContribution[];
  views: ExtensionViewContribution[];
}

export interface ExtensionRuntimeProjectionSnapshot {
  schema: string;
  state: 'ready' | 'degraded' | 'starting' | 'stopped' | 'error' | 'unknown';
  summary: string;
  updatedAt: string;
  details: Record<string, unknown>;
}

export interface ExtensionManagementItem {
  id: string;
  name: string;
  version: string;
  installedVersions: string[];
  activeVersion: string;
  description: string;
  enabled: boolean;
  running: boolean;
  permissions: string[];
  tags: string[];
  commands: ExtensionCommandContribution[];
  contributions: ExtensionContributionSnapshot;
  configPath: string;
  configYaml: string;
  dependencies: ExtensionDependencySnapshot[];
  logState: ExtensionLogState;
  operationalState: 'disabled' | 'stopped' | 'ready' | 'degraded' | 'error';
  operationalSummary: string;
  runtimeProjection?: ExtensionRuntimeProjectionSnapshot;
}

export interface ExtensionManagementSnapshot {
  extensionRoot: string;
  activeConfigPath: string;
  extensions: ExtensionManagementItem[];
}

export type ExtensionInstallSourceInput =
  | { kind: 'local_file' }
  | { kind: 'release_manifest'; url: string }
  | { kind: 'registry'; catalogUrl: string; extensionId: string; channel?: 'stable' | 'beta' | 'nightly' }
  | { kind: 'repository'; repository: string; tag: string };

export interface ExtensionLifecycleResult {
  status: 'success' | 'error';
  message: string;
}

export interface ExtensionCommandResult<T = unknown> {
  status: 'success' | 'error';
  result?: T;
  message: string;
}

export interface SkillCatalogResponse {
  status: 'success' | 'error';
  snapshot?: SkillCatalogSnapshot;
  message: string;
}

export interface AvatarAppearanceSettings {
  modelId: string;
  displayScale: number;
  placementId: string;
}

export interface AvatarManualAction {
  id: string;
  label: string;
  category: string;
  manualOnly: boolean;
  toggle: boolean;
  requires: string[];
  exclusiveGroup?: string;
}

export interface AvatarActionStateSnapshot {
  actionId?: string;
  state?: 'inactive' | 'active' | 'running' | 'completed' | 'rejected';
  activeActionIds: string[];
  message?: string;
}

export interface AvatarActionIntentRequest {
  id: string;
  operation: 'trigger' | 'activate' | 'deactivate';
}

export interface PresenceHitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PresenceDragPoint {
  screenX: number;
  screenY: number;
  devicePixelRatio?: number;
}

export type PresenceInteractionPolicy = 'full-window' | 'alpha-shape' | 'transparent';

export type DiagnosticLocationKey =
  | 'logs'
  | 'kernelLog'
  | 'kernelPrettyLog'
  | 'cognitionLog'
  | 'audioTtsLog'
  | 'audioAsrLog'
  | 'avatarHostLog'
  | 'avatarHostBuildLog'
  | 'avatarHostPackage'
  | 'avatarSdkPackage';

export interface ObservabilityProcessLogRef {
  id: string;
  owner: string;
  label: string;
  source: 'known_process' | 'details_ref' | 'artifact_ref' | 'extension_projection';
  path: string;
  exists: boolean;
}

export interface ObservabilityRecentErrorSummary {
  trace_id: string;
  timestamp: string;
  source: 'event' | 'audit' | 'model-invocation' | 'dlq';
  title: string;
  summary: string;
  owner: string;
  runtime_id?: string;
  event_type?: string;
  action?: string;
  outcome?: string | null;
  error_code?: string | null;
  diagnostic_hint?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
  process_log_refs: ObservabilityProcessLogRef[];
}

export interface ObservabilityEventSummary {
  timestamp: string;
  level: string;
  event_type: string;
  event_action?: string | null;
  event_outcome?: string | null;
  owner: string;
  module: string;
  runtime_id: string;
  phase?: string | null;
  trace_id: string;
  error_code?: string | null;
  diagnostic_hint?: string | null;
  details_ref?: string | null;
  artifact_ref?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
}

export interface ObservabilityAuditSummary {
  timestamp: string;
  action: string;
  target_kind: string;
  target_name?: string | null;
  owner: string;
  runtime_id: string;
  trace_id: string;
  outcome: string;
  reason?: string | null;
  diagnostic_hint?: string | null;
  details_ref?: string | null;
  artifact_ref?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
}

export interface ObservabilityModelInvocationSummary {
  timestamp: string;
  invocation_id: string;
  trace_id: string;
  purpose: string;
  capture_category: string;
  capture_mode: string;
  owner: string;
  runtime_id: string;
  provider_id: string;
  model_id: string;
  outcome: string;
  duration_ms?: number | null;
  prompt_chars?: number | null;
  response_chars?: number | null;
  prompt_hash?: string | null;
  response_hash?: string | null;
  error_code?: string | null;
  error_summary?: string | null;
}

export interface ObservabilityDlqSummary {
  id: number;
  trace_id: string;
  event_type: string;
  owner: string;
  failure_phase: string;
  error_code: string;
  status: string;
  created_at: string;
  resolved_at?: string | null;
  resolution?: string | null;
  diagnostic_hint: string;
  redacted_payload_summary: string;
  replay_command: string;
  source_path: string;
}

export interface ObservabilitySpanSummary {
  source: 'kernel' | 'cognition' | 'unknown';
  name: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: string;
  file_ref: string;
}

export interface ObservabilityMetricRef {
  id: string;
  source: 'kernel' | 'cognition' | 'unknown';
  path: string;
  note: string;
}

export interface ObservabilityStorageStatus {
  mode: 'jsonl_scan' | 'sqlite_index';
  owner: 'desktop-main';
  index_path: string;
  pending_index_path?: string | null;
  refreshed_at?: string | null;
  source_fingerprint?: string | null;
  recovery_note: string;
}

export interface ObservabilityRetentionPolicy {
  events_days: number;
  traces_days: number;
  metrics_days: number;
  audit_days: number;
  model_invocation_days: number;
  model_invocation_capture_days: number;
  application_log_days: number;
  dlq_days: number;
  bundles_days: number;
  bundle_export_dir: string;
  include_model_invocation_captures: boolean;
  process_tail_bytes: number;
}

export interface ObservabilityMaintenanceStatus {
  generated_at: string;
  storage: ObservabilityStorageStatus;
  retention: ObservabilityRetentionPolicy;
  model_invocation_capture_mode: 'off' | 'summary' | 'full';
  notes: string[];
}

export interface ObservabilityTraceProjection {
  generated_at: string;
  trace_id: string;
  storage: ObservabilityStorageStatus;
  events: ObservabilityEventSummary[];
  audit: ObservabilityAuditSummary[];
  modelInvocations: ObservabilityModelInvocationSummary[];
  dlq: ObservabilityDlqSummary[];
  spans: ObservabilitySpanSummary[];
  process_log_refs: ObservabilityProcessLogRef[];
  metric_refs: ObservabilityMetricRef[];
  related_runtime_ids: string[];
  related_extensions: string[];
  related_providers: string[];
  notes: string[];
}

export interface ObservabilityBundleExportResult {
  trace_id: string;
  bundle_id: string;
  exported_at: string;
  bundle_root: string;
  manifest_path: string;
  included_sections: string[];
  process_log_snippets: number;
  model_invocation_captures: number;
  storage: ObservabilityStorageStatus;
  notes: string[];
}

export interface ObservabilityCleanupBucketResult {
  id: 'events' | 'traces' | 'metrics' | 'audit' | 'model_invocation_records' | 'model_invocation_captures' | 'process' | 'dlq' | 'bundles' | 'index';
  retention_days: number;
  deleted_records: number;
  deleted_files: number;
  reclaimed_bytes: number;
  note: string;
}

export interface ObservabilityCleanupResult {
  executed_at: string;
  storage: ObservabilityStorageStatus;
  retention: ObservabilityRetentionPolicy;
  buckets: ObservabilityCleanupBucketResult[];
  protected_paths: string[];
  notes: string[];
}

interface ExtensionStatusChangedPayload {
  extensionId: string;
  event: 'loaded' | 'started' | 'stopped' | 'error';
  message?: string;
  timestamp: number;
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, data: T): void => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopHost', {
  sendPerception: (event: ClientPerceptionEvent): Promise<void> =>
    ipcRenderer.invoke('ui:send-perception', event),

  getConnectionStatus: (): Promise<ConnectionStatus> =>
    ipcRenderer.invoke('ui:get-connection-status'),

  getAudioStatus: (): Promise<AudioStatusPayload | null> =>
    ipcRenderer.invoke('ui:get-audio-status'),

  getRuntimeReadiness: (): Promise<RuntimeReadinessCatalog | null> =>
    ipcRenderer.invoke('ui:get-runtime-readiness'),

  getObservabilityRecentErrors: (): Promise<ObservabilityRecentErrorSummary[]> =>
    ipcRenderer.invoke('ui:get-observability-recent-errors'),

  getObservabilityRecentEvents: (): Promise<ObservabilityEventSummary[]> =>
    ipcRenderer.invoke('ui:get-observability-recent-events'),

  getObservabilityMaintenance: (): Promise<ObservabilityMaintenanceStatus> =>
    ipcRenderer.invoke('ui:get-observability-maintenance'),

  getObservabilityTrace: (traceId: string): Promise<ObservabilityTraceProjection> =>
    ipcRenderer.invoke('ui:get-observability-trace', traceId),

  exportObservabilityBundle: (traceId: string): Promise<ObservabilityBundleExportResult> =>
    ipcRenderer.invoke('ui:export-observability-bundle', traceId),

  cleanupObservability: (): Promise<ObservabilityCleanupResult> =>
    ipcRenderer.invoke('ui:cleanup-observability'),

  getControlCenterSettings: (): Promise<ControlCenterSettingsSnapshot> =>
    ipcRenderer.invoke('ui:get-control-center-settings'),

  getMemoryPreview: (): Promise<MemoryArchitectureSnapshot> =>
    ipcRenderer.invoke('ui:get-memory-preview'),

  saveControlCenterSettings: (payload: ControlCenterSettingsSnapshot): Promise<SaveControlCenterSettingsResult> =>
    ipcRenderer.invoke('ui:save-control-center-settings', payload),

  getExtensions: (): Promise<ExtensionManagementSnapshot> =>
    ipcRenderer.invoke('ui:get-extensions'),

  saveExtensionConfig: (payload: { extensionId: string; configYaml: string }): Promise<ExtensionManagementSnapshot> =>
    ipcRenderer.invoke('ui:save-extension-config', payload),

  prepareExtensionInstall: (payload: ExtensionInstallSourceInput): Promise<ExtensionInstallPreview> =>
    ipcRenderer.invoke('ui:prepare-extension-install', payload),

  commitExtensionInstall: (payload: { transactionId: string; approvedPermissions: string[] }): Promise<ExtensionInstallResult> =>
    ipcRenderer.invoke('ui:commit-extension-install', payload),

  cancelExtensionInstall: (payload: { transactionId: string }): Promise<ExtensionInstallResult> =>
    ipcRenderer.invoke('ui:cancel-extension-install', payload),

  uninstallExtension: (payload: { extensionId: string; version: string }): Promise<ExtensionUninstallResult> =>
    ipcRenderer.invoke('ui:uninstall-extension', payload),

  requestExtensionLifecycle: (payload: { extensionId: string; version?: string; operation: 'start' | 'stop' }): Promise<ExtensionLifecycleResult> =>
    ipcRenderer.invoke('ui:request-extension-lifecycle', payload),

  executeExtensionCommand: <T = unknown>(payload: { commandId: string; args?: unknown[] }): Promise<ExtensionCommandResult<T>> =>
    ipcRenderer.invoke('ui:execute-extension-command', payload),

  getSkillCatalog: (): Promise<SkillCatalogResponse> =>
    ipcRenderer.invoke('ui:get-skill-catalog'),

  getAvatarAppearance: (): Promise<AvatarAppearanceSettings> =>
    ipcRenderer.invoke('ui:get-avatar-appearance'),

  setAvatarAppearance: (payload: AvatarAppearanceSettings): Promise<AvatarAppearanceSettings> =>
    ipcRenderer.invoke('ui:set-avatar-appearance', payload),

  resetAvatarPlacement: (): Promise<void> =>
    ipcRenderer.invoke('ui:reset-avatar-placement'),

  getAvatarManualActions: (): Promise<AvatarManualAction[]> =>
    ipcRenderer.invoke('ui:get-avatar-manual-actions'),

  getAvatarActionState: (): Promise<AvatarActionStateSnapshot> =>
    ipcRenderer.invoke('ui:get-avatar-action-state'),

  setAvatarAction: (payload: AvatarActionIntentRequest): Promise<void> =>
    ipcRenderer.invoke('ui:set-avatar-action', payload),

  sendAudioInput: (payload: AudioInputPayload): Promise<void> =>
    ipcRenderer.invoke('ui:send-audio-input', payload),

  onReply: (callback: (reply: ReplyPayload) => void): (() => void) =>
    subscribe<ReplyPayload>('ui:reply', callback),

  onEmotionUpdate: (callback: (emotion: EmotionStatePayload) => void): (() => void) =>
    subscribe<EmotionStatePayload>('ui:emotion-update', callback),

  onThoughtUpdate: (callback: (thought: ThoughtStatePayload) => void): (() => void) =>
    subscribe<ThoughtStatePayload>('ui:thought-update', callback),

  onConnectionStatus: (callback: (status: ConnectionStatus) => void): (() => void) =>
    subscribe<ConnectionStatus>('ui:connection-status', callback),

  onAvatarStatus: (callback: (status: AvatarStatus) => void): (() => void) =>
    subscribe<AvatarStatus>('ui:avatar-status', callback),

  getAvatarDiagnostics: (): Promise<AvatarDiagnosticsSnapshot> =>
    ipcRenderer.invoke('ui:get-avatar-diagnostics'),

  getAvatarPackageCatalog: (): Promise<AvatarPackageCatalogSnapshot> =>
    ipcRenderer.invoke('ui:get-avatar-package-catalog'),

  getCharacterPresentationProjection: (): Promise<CharacterPresentationProjectionPayload> =>
    ipcRenderer.invoke('ui:get-character-presentation-projection'),

  onAudioPlay: (callback: (payload: AudioPlayPayload) => void): (() => void) =>
    subscribe<AudioPlayPayload>('ui:audio-play', callback),

  onAudioStatus: (callback: (payload: AudioStatusPayload) => void): (() => void) =>
    subscribe<AudioStatusPayload>('ui:audio-status', callback),

  onRuntimeReadiness: (callback: (payload: RuntimeReadinessCatalog) => void): (() => void) =>
    subscribe<RuntimeReadinessCatalog>('ui:runtime-readiness', callback),

  onAudioTranscript: (callback: (payload: AudioTranscriptPayload) => void): (() => void) =>
    subscribe<AudioTranscriptPayload>('ui:audio-transcript', callback),

  onAvatarAppearance: (callback: (payload: AvatarAppearanceSettings) => void): (() => void) =>
    subscribe<AvatarAppearanceSettings>('ui:avatar-appearance', callback),

  onCharacterPresentationProjection: (
    callback: (payload: CharacterPresentationProjectionPayload) => void,
  ): (() => void) =>
    subscribe<CharacterPresentationProjectionPayload>('ui:character-presentation-projection', callback),

  onAvatarActionState: (callback: (payload: AvatarActionStateSnapshot) => void): (() => void) =>
    subscribe<AvatarActionStateSnapshot>('ui:avatar-action-state', callback),

  onExtensionStatusChanged: (callback: (payload: ExtensionStatusChangedPayload) => void): (() => void) =>
    subscribe<ExtensionStatusChangedPayload>('ui:extension-status-changed', callback),

  openControlCenter: (): Promise<void> =>
    ipcRenderer.invoke('ui:open-control-center'),

  minimizeWindow: (): Promise<void> =>
    ipcRenderer.invoke('ui:minimize-window'),

  toggleMaximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke('ui:toggle-maximize-window'),

  closeWindow: (): Promise<void> =>
    ipcRenderer.invoke('ui:close-window'),

  openDiagnosticLocation: (key: DiagnosticLocationKey): Promise<void> =>
    ipcRenderer.invoke('ui:open-diagnostic-location', key),

  updatePresenceHitRegion: (rects: PresenceHitRegionRect[]): Promise<void> =>
    ipcRenderer.invoke('ui:update-presence-hit-region', rects),

  setPresenceInteractionPolicy: (policy: PresenceInteractionPolicy): Promise<void> =>
    ipcRenderer.invoke('ui:set-presence-interaction-policy', policy),

  beginPresenceDrag: (point?: PresenceDragPoint): void => {
    ipcRenderer.send('ui:begin-presence-drag', point);
  },

  movePresenceWindowTo: (point: PresenceDragPoint): void => {
    ipcRenderer.send('ui:move-presence-window-to', point);
  },

  endPresenceDrag: (): void => {
    ipcRenderer.send('ui:end-presence-drag');
  },
});
