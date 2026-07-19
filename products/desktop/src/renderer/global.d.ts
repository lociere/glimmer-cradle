import type {
  ChannelReplyMessage,
  ExtensionInstallPreview,
  ExtensionInstallResult,
  ExtensionUninstallResult,
  PresentationDownstreamFrame,
} from '@glimmer-cradle/protocol';

interface ReplyPayload {
  trace_id: string;
  text: string;
  messages: ChannelReplyMessage[];
}

interface EmotionStatePayload {
  emotion_type: string;
  intensity: number;
  trigger: string;
  timestamp: string;
}

interface ThoughtStatePayload {
  trace_id: string;
  active: boolean;
  hint: string;
  timestamp: string;
}

interface ClientPerceptionEvent {
  content: string;
}

interface ConnectionStatus {
  status: 'connecting' | 'online' | 'offline';
}

type AvatarRenderState = 'unity-pending' | 'unity';

/** Kernel 上报的外部 shell 状态；renderer 本地渲染状态不走这条 IPC。 */
type AvatarStatusKind = 'unity' | 'offline';

interface AvatarStatus {
  hostKind: AvatarStatusKind;
}

interface AvatarSdkDiagnosticsSnapshot {
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

interface AvatarDiagnosticsSnapshot {
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

interface AudioPlayPayload {
  trace_id: string;
  audio_id: string;
  audio_uri?: string;
  audio_data?: string;
  mime_type?: string;
  duration_ms?: number;
}

interface AudioProviderStatusPayload {
  provider_id: string;
  role: 'primary' | 'fallback';
  execution: 'cloud' | 'local';
  status: 'ready' | 'degraded' | 'unavailable' | 'circuit_open' | 'unknown';
  message?: string;
}

interface AudioCapabilityStatusPayload {
  enabled: boolean;
  disabled_reason?: string;
  active_provider?: string;
  route_state: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  providers: AudioProviderStatusPayload[];
}

interface AudioStatusPayload {
  updated_at: number;
  tts: AudioCapabilityStatusPayload;
  asr: AudioCapabilityStatusPayload;
}

interface ControlCenterSettingsSnapshot {
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
  avatar: {
    enabled: boolean;
  };
  audio: {
    ttsEnabled: boolean;
    asrEnabled: boolean;
    cloudVoiceId: string;
  };
}

interface MemoryArchitectureItem {
  id: string;
  source: 'conversation_message' | 'experience_moment' | 'memory_revision' | 'role_knowledge';
  title: string;
  body: string;
  timestamp?: string;
}

interface MemoryArchitectureMetrics {
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

interface MemoryArchitectureSnapshot {
  updatedAt: number;
  items: MemoryArchitectureItem[];
  metrics: MemoryArchitectureMetrics;
}

interface SaveControlCenterSettingsResult {
  status: 'saved';
  message: string;
}

interface ExtensionDependencyHealthSnapshot {
  state: 'ready' | 'unavailable' | 'unknown' | 'not_checked';
  label: string;
  summary: string;
  endpoint?: string;
  checkedAt: number;
}

interface ExtensionDependencySnapshot {
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

interface ExtensionLogState {
  lastEvent: 'loaded' | 'started' | 'stopped' | 'error' | 'unknown';
  message: string;
  timestamp: string;
}

interface ExtensionCommandContribution {
  command: string;
  title: string;
  category: string;
  state: 'enabled' | 'disabled' | 'hidden' | 'unsupported';
  disabledReason?: string;
}

interface ExtensionSettingContribution {
  key: string;
  title: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown';
  defaultValue?: unknown;
}

interface ExtensionSkillContribution {
  id: string;
  name: string;
  description: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  riskLevel: string;
  confirmationRequired: boolean;
}

interface ExtensionViewContribution {
  id: string;
  title: string;
  when: string;
}

interface ExtensionContributionSnapshot {
  commands: ExtensionCommandContribution[];
  settings: ExtensionSettingContribution[];
  skills: ExtensionSkillContribution[];
  views: ExtensionViewContribution[];
}

interface ExtensionRuntimeProjectionSnapshot {
  schema: string;
  state: 'ready' | 'degraded' | 'starting' | 'stopped' | 'error' | 'unknown';
  summary: string;
  updatedAt: string;
  details: Record<string, unknown>;
}

interface ExtensionManagementItem {
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

interface ExtensionManagementSnapshot {
  extensionRoot: string;
  activeConfigPath: string;
  extensions: ExtensionManagementItem[];
}

type ExtensionInstallSourceInput =
  | { kind: 'local_file' }
  | { kind: 'release_manifest'; url: string }
  | { kind: 'registry'; catalogUrl: string; extensionId: string; channel?: 'stable' | 'beta' | 'nightly' }
  | { kind: 'repository'; repository: string; tag: string };

interface ExtensionLifecycleResult {
  status: 'success' | 'error';
  message: string;
}

interface ExtensionCommandResult<T = unknown> {
  status: 'success' | 'error';
  result?: T;
  message: string;
}

type SkillProviderKind = 'core' | 'extension' | 'mcp_server' | 'user';
type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';
type SkillRuntimeStatus = 'ready' | 'contract_only';
type SkillProviderRuntimeState = 'ready' | 'contract_only' | 'connecting' | 'degraded' | 'unavailable' | 'stopped';
type SkillAudience = 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';

interface SkillProviderRef {
  kind: SkillProviderKind;
  id: string;
}

interface SkillPolicySnapshot {
  riskLevel: SkillRiskLevel;
  confirmationRequired: boolean;
  sideEffects: string[];
  audit: boolean;
}

type SkillCatalogResponse = NonNullable<PresentationDownstreamFrame['skill_catalog_response']>;
type SkillCatalogSnapshot = NonNullable<SkillCatalogResponse['snapshot']>;
type SkillCatalogEntrySnapshot = SkillCatalogSnapshot['entries'][number];
type SkillProviderRuntimeSnapshot = SkillCatalogSnapshot['providerRuntimes'][number];

interface AvatarAppearanceSettings {
  modelId: string;
  displayScale: number;
  placementId: string;
}

interface AvatarManualAction {
  id: string;
  label: string;
  category: string;
  manualOnly: boolean;
  toggle: boolean;
  requires: string[];
  exclusiveGroup?: string;
}

interface AvatarActionStateSnapshot {
  actionId?: string;
  state?: 'inactive' | 'active' | 'running' | 'completed' | 'rejected';
  activeActionIds: string[];
  message?: string;
}

interface AvatarActionIntentRequest {
  id: string;
  operation: 'trigger' | 'activate' | 'deactivate';
}

interface AvatarPackageSnapshot {
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

interface AvatarPackageCatalogSnapshot {
  defaultAvatarPackageId: string;
  defaultModelId: string;
  packages: AvatarPackageSnapshot[];
}

interface CharacterPresentationProjectionPayload {
  avatar_package_id: string;
  model_id: string;
  display_name: string;
  kind: 'live2d';
  backend: 'unity';
  host_kind: 'unity' | 'offline';
  avatar_state: 'pending' | 'starting' | 'ready' | 'degraded' | 'stopped';
  appearance: {
    placement_id?: string;
    display_scale: number;
  };
  lifecycle: {
    worker_window_state: 'isolated' | 'visible' | 'unknown';
    composition_surface_state: 'attached' | 'failed' | 'unknown';
    first_frame_presented: boolean;
    interaction_ready: boolean;
    ready: boolean;
    summary: string;
  };
}

type RuntimeReadinessOwner = 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension';
type RuntimeReadinessState = 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped';
type RuntimeResourceState = 'pending' | 'ready' | 'missing' | 'degraded' | 'failed' | 'unknown';

interface RuntimeResourceSnapshot {
  resource_id: string;
  resource_kind: string;
  desired_state: RuntimeResourceState;
  actual_state: RuntimeResourceState;
  readiness: RuntimeResourceState;
  summary: string;
  recovery_actions: string[];
}

interface RuntimeReconcilerSnapshot {
  desired: string;
  actual: string;
  readiness: RuntimeResourceState;
  resources: RuntimeResourceSnapshot[];
}

interface RuntimeReadinessSnapshot {
  runtime_id: string;
  owner: RuntimeReadinessOwner;
  phase: string;
  state: RuntimeReadinessState;
  blocking: boolean;
  summary: string;
  details_ref?: string;
  duration_ms?: number;
  reconciler?: RuntimeReconcilerSnapshot;
}

interface RuntimeReadinessCatalog {
  updated_at: number;
  runtimes: RuntimeReadinessSnapshot[];
}

interface AudioInputPayload {
  trace_id?: string;
  audio_id: string;
  audio_data: string;
  mime_type: string;
  duration_ms?: number;
  sample_rate?: number;
}

interface AudioTranscriptPayload {
  trace_id: string;
  audio_id: string;
  status: 'success' | 'error';
  text?: string;
  message?: string;
}

interface PresenceHitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PresenceDragPoint {
  screenX: number;
  screenY: number;
  devicePixelRatio?: number;
}

type PresenceInteractionPolicy = 'full-window' | 'alpha-shape' | 'transparent';

type DiagnosticLocationKey =
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

interface ObservabilityProcessLogRef {
  id: string;
  owner: string;
  label: string;
  source: 'known_process' | 'details_ref' | 'artifact_ref' | 'extension_projection';
  path: string;
  exists: boolean;
}

interface ObservabilityRecentErrorSummary {
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

interface ObservabilityEventSummary {
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

interface ObservabilityAuditSummary {
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

interface ObservabilityModelInvocationSummary {
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

interface ObservabilityDlqSummary {
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

interface ObservabilitySpanSummary {
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

interface ObservabilityMetricRef {
  id: string;
  source: 'kernel' | 'cognition' | 'unknown';
  path: string;
  note: string;
}

interface ObservabilityStorageStatus {
  mode: 'jsonl_scan' | 'sqlite_index';
  owner: 'desktop-main';
  index_path: string;
  pending_index_path?: string | null;
  refreshed_at?: string | null;
  source_fingerprint?: string | null;
  recovery_note: string;
}

interface ObservabilityRetentionPolicy {
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

interface ObservabilityMaintenanceStatus {
  generated_at: string;
  storage: ObservabilityStorageStatus;
  retention: ObservabilityRetentionPolicy;
  model_invocation_capture_mode: 'off' | 'summary' | 'full';
  notes: string[];
}

interface ObservabilityTraceProjection {
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

interface ObservabilityBundleExportResult {
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

interface ObservabilityCleanupBucketResult {
  id: 'events' | 'traces' | 'metrics' | 'audit' | 'model_invocation_records' | 'model_invocation_captures' | 'process' | 'dlq' | 'bundles' | 'index';
  retention_days: number;
  deleted_records: number;
  deleted_files: number;
  reclaimed_bytes: number;
  note: string;
}

interface ObservabilityCleanupResult {
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

interface DesktopHostAPI {
  sendPerception: (event: ClientPerceptionEvent) => Promise<void>;
  getConnectionStatus: () => Promise<ConnectionStatus>;
  getAudioStatus: () => Promise<AudioStatusPayload | null>;
  getRuntimeReadiness: () => Promise<RuntimeReadinessCatalog | null>;
  getObservabilityRecentErrors: () => Promise<ObservabilityRecentErrorSummary[]>;
  getObservabilityRecentEvents: () => Promise<ObservabilityEventSummary[]>;
  getObservabilityMaintenance: () => Promise<ObservabilityMaintenanceStatus>;
  getObservabilityTrace: (traceId: string) => Promise<ObservabilityTraceProjection>;
  exportObservabilityBundle: (traceId: string) => Promise<ObservabilityBundleExportResult>;
  cleanupObservability: () => Promise<ObservabilityCleanupResult>;
  getControlCenterSettings: () => Promise<ControlCenterSettingsSnapshot>;
  getMemoryPreview: () => Promise<MemoryArchitectureSnapshot>;
  saveControlCenterSettings: (
    payload: ControlCenterSettingsSnapshot,
  ) => Promise<SaveControlCenterSettingsResult>;
  getExtensions: () => Promise<ExtensionManagementSnapshot>;
  saveExtensionConfig: (
    payload: { extensionId: string; configYaml: string },
  ) => Promise<ExtensionManagementSnapshot>;
  prepareExtensionInstall: (payload: ExtensionInstallSourceInput) => Promise<ExtensionInstallPreview>;
  commitExtensionInstall: (
    payload: { transactionId: string; approvedPermissions: string[] },
  ) => Promise<ExtensionInstallResult>;
  cancelExtensionInstall: (payload: { transactionId: string }) => Promise<ExtensionInstallResult>;
  uninstallExtension: (
    payload: { extensionId: string; version: string },
  ) => Promise<ExtensionUninstallResult>;
  requestExtensionLifecycle: (
    payload: { extensionId: string; version?: string; operation: 'start' | 'stop' },
  ) => Promise<ExtensionLifecycleResult>;
  executeExtensionCommand: <T = unknown>(
    payload: { commandId: string; args?: unknown[] },
  ) => Promise<ExtensionCommandResult<T>>;
  getSkillCatalog: () => Promise<SkillCatalogResponse>;
  getAvatarAppearance: () => Promise<AvatarAppearanceSettings>;
  getAvatarPackageCatalog: () => Promise<AvatarPackageCatalogSnapshot>;
  getCharacterPresentationProjection: () => Promise<CharacterPresentationProjectionPayload>;
  setAvatarAppearance: (payload: AvatarAppearanceSettings) => Promise<AvatarAppearanceSettings>;
  resetAvatarPlacement: () => Promise<void>;
  getAvatarManualActions: () => Promise<AvatarManualAction[]>;
  getAvatarActionState: () => Promise<AvatarActionStateSnapshot>;
  setAvatarAction: (payload: AvatarActionIntentRequest) => Promise<void>;
  sendAudioInput: (payload: AudioInputPayload) => Promise<void>;
  onReply: (callback: (reply: ReplyPayload) => void) => () => void;
  onEmotionUpdate: (callback: (emotion: EmotionStatePayload) => void) => () => void;
  onThoughtUpdate: (callback: (thought: ThoughtStatePayload) => void) => () => void;
  onConnectionStatus: (callback: (status: ConnectionStatus) => void) => () => void;
  onAvatarStatus: (callback: (status: AvatarStatus) => void) => () => void;
  getAvatarDiagnostics: () => Promise<AvatarDiagnosticsSnapshot>;
  onAudioPlay: (callback: (payload: AudioPlayPayload) => void) => () => void;
  onAudioStatus: (callback: (payload: AudioStatusPayload) => void) => () => void;
  onRuntimeReadiness: (callback: (payload: RuntimeReadinessCatalog) => void) => () => void;
  onAudioTranscript: (callback: (payload: AudioTranscriptPayload) => void) => () => void;
  onAvatarAppearance: (callback: (payload: AvatarAppearanceSettings) => void) => () => void;
  onCharacterPresentationProjection: (
    callback: (payload: CharacterPresentationProjectionPayload) => void,
  ) => () => void;
  onAvatarActionState: (callback: (payload: AvatarActionStateSnapshot) => void) => () => void;
  onExtensionStatusChanged: (callback: (payload: ExtensionStatusChangedPayload) => void) => () => void;
  openControlCenter: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  openDiagnosticLocation: (key: DiagnosticLocationKey) => Promise<void>;
  updatePresenceHitRegion: (rects: PresenceHitRegionRect[]) => Promise<void>;
  setPresenceInteractionPolicy: (policy: PresenceInteractionPolicy) => Promise<void>;
  beginPresenceDrag: (point?: PresenceDragPoint) => void;
  movePresenceWindowTo: (point: PresenceDragPoint) => void;
  endPresenceDrag: () => void;
}

declare global {
  interface Window {
    desktopHost: DesktopHostAPI;
  }
}

export {};
