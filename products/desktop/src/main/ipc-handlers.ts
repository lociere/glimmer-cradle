import { app, BrowserWindow, shell, dialog, clipboard, Notification, type OpenDialogOptions } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import WebSocket from 'ws';
import YAML from 'yaml';
import {
  type AudioStatusPayload,
  type AvatarActionStateDocument,
  type PresentationUpstreamFrame,
  type CharacterPresentationProjectionPayload,
  type ExtensionInstallCommitRequest,
  type ExtensionInstallPrepareRequest,
  type ExtensionInstallPreview,
  type ExtensionInstallResult,
  type ExtensionInstallationProjection,
  type ExtensionRuntimeProjection,
  type ExtensionUninstallResult,
  type RuntimeReadinessCatalog,
  type SkillCatalogSnapshot,
  getPresentationFrameClass,
  isPresentationFrameKind,
} from '@glimmer-cradle/protocol';
import {
  loadAvatarPackageCatalog,
  resolveAvatarPackage,
  resolveRepoAssetPath,
  type AvatarPackageCatalogSnapshot,
} from './avatar-package-catalog';
import {
  resolveDesktopAvatarPaths,
} from './avatar-paths';
import { desktopIpcRouter } from './ipc/desktop-ipc-router';
import {
  fileExistsSync,
  resolveDesktopConfigChildPath,
  resolveDesktopObservabilityPath,
  resolveDesktopPackagePath,
  resolveDesktopProjectPath,
  resolveDesktopRepoChildPath,
  resolveDesktopProjectRoots,
  resolveDesktopStatePath,
  resolveDesktopRunPath,
} from './project-paths';
import { appendDesktopAuditRecord } from './observability-audit';
import {
  cleanupObservability,
  exportObservabilityBundle,
  getObservabilityMaintenanceStatus,
  listRecentObservabilityEvents,
  listRecentObservabilityErrors,
  queryObservabilityTrace,
} from './observability-query';
import type { SurfaceId } from './surface-registry';

const RECONNECT_INTERVAL_MS = 3000;
const PROJECT_ROOTS = resolveDesktopProjectRoots({
  cwd: process.cwd(),
  dirName: __dirname,
  resourcesPath: app.isPackaged ? process.resourcesPath : '',
  exeDir: app.isPackaged ? path.dirname(app.getPath('exe')) : '',
  configuredAppRoot: process.env.GLIMMER_CRADLE_APP_ROOT,
  configuredRepoRoot: process.env.GLIMMER_CRADLE_REPO_ROOT,
  configuredDataRoot: process.env.GLIMMER_CRADLE_DATA_ROOT,
  configuredRunRoot: process.env.GLIMMER_CRADLE_RUN_ROOT,
});
const { repoRoot: REPO_ROOT, extensionsRoot: EXTENSION_ROOT } = PROJECT_ROOTS;
const AVATAR_PATHS = resolveDesktopAvatarPaths(PROJECT_ROOTS);

type KernelConnectionStatus = 'connecting' | 'online' | 'offline';
type AvatarReadinessTone = 'ready' | 'warn' | 'error';

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

interface ExtensionStatusChangedPayload {
  extensionId: string;
  event: 'loaded' | 'started' | 'stopped' | 'error';
  message?: string;
  timestamp: number;
}

let kernelSocket: WebSocket | null = null;
let kernelWsUrl = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const rendererWindows = new Set<BrowserWindow>();
const rendererSurfaces = new Map<BrowserWindow, SurfaceId>();
const deliveredAudioIds = new Set<string>();
const MAX_DELIVERED_AUDIO_IDS = 256;
let handlersRegistered = false;
let hasConnectedToKernel = false;
let waitingForKernelLogged = false;
let currentConnectionStatus: KernelConnectionStatus = 'connecting';
let kernelShutdownRequested = false;
const kernelDisconnectWaiters = new Set<() => void>();
const extensionLifecycleWaiters = new Map<string, {
  resolve: (result: ExtensionLifecycleResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const extensionCommandWaiters = new Map<string, {
  resolve: (result: ExtensionCommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const extensionRuntimeProjectionWaiters = new Map<string, {
  resolve: (result: ExtensionRuntimeProjectionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const skillCatalogWaiters = new Map<string, {
  resolve: (result: SkillCatalogResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const extensionInstallPreviewWaiters = new Map<string, {
  resolve: (result: ExtensionInstallPreview) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const extensionInstallResultWaiters = new Map<string, {
  resolve: (result: ExtensionInstallResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
const extensionUninstallWaiters = new Map<string, {
  resolve: (result: ExtensionUninstallResult) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
let lastAudioStatus: AudioStatusPayload | null = null;
let lastAvatarActionState: AvatarActionStateSnapshot = { activeActionIds: [] };
let lastCharacterPresentationProjection: CharacterPresentationProjectionPayload | null = null;
let lastRuntimeReadiness: RuntimeReadinessCatalog | null = null;
let lastExtensionRuntimeProjections: ExtensionRuntimeProjection[] = [];
let lastExtensionInstallationProjections: ExtensionInstallationProjection[] = [];
let handlerOptions: RegisterIPCHandlersOptions = {};

type SqliteDatabase = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
  close: () => void;
};

type SqliteDatabaseConstructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

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
  tone: AvatarReadinessTone;
  summary: string;
  nextAction: string;
}

interface AvatarPackageCatalogResponse extends AvatarPackageCatalogSnapshot {}

type ExtensionDependencyTone = 'ready' | 'missing' | 'optional';
type ExtensionDependencyHealthState = 'ready' | 'unavailable' | 'unknown' | 'not_checked';
type ExtensionLifecycleOperation = 'start' | 'stop';

interface ExtensionDependencyHealthSnapshot {
  state: ExtensionDependencyHealthState;
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
  tone: ExtensionDependencyTone;
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

interface ExtensionRuntimeProjectionSnapshot {
  schema: string;
  state: 'ready' | 'degraded' | 'starting' | 'stopped' | 'error' | 'unknown';
  summary: string;
  updatedAt: string;
  details: Record<string, unknown>;
}

interface ExtensionRuntimeProjectionResponse {
  status: 'success' | 'error';
  projections: ExtensionRuntimeProjection[];
  installations: ExtensionInstallationProjection[];
  message: string;
}

interface ExtensionLifecycleRequest {
  extensionId: string;
  version?: string;
  operation: ExtensionLifecycleOperation;
}

interface ExtensionLifecycleResult {
  status: 'success' | 'error';
  message: string;
}

interface ExtensionCommandRequest {
  commandId: string;
  args?: unknown[];
}

interface ExtensionCommandResult {
  status: 'success' | 'error';
  result?: unknown;
  message: string;
}

interface SkillCatalogResponse {
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

interface AvatarActionIntentRequest {
  id: string;
  operation: 'trigger' | 'activate' | 'deactivate';
}

export interface RegisterIPCHandlersOptions {
  onAvatarAppearanceChanged?: (appearance: AvatarAppearanceSettings) => void;
  onAvatarStatusChanged?: (hostKind: 'unity' | 'offline') => void;
}

const DIAGNOSTIC_LOCATIONS: Record<string, string> = {
  logs: resolveDesktopObservabilityPath(PROJECT_ROOTS, 'logs'),
  kernelLog: resolveDesktopObservabilityPath(PROJECT_ROOTS, 'logs', 'application', 'kernel.jsonl'),
  kernelPrettyLog: resolveDesktopObservabilityPath(PROJECT_ROOTS, 'logs', 'application', 'kernel.pretty.log'),
  cognitionLog: resolveDesktopObservabilityPath(PROJECT_ROOTS, 'logs', 'application', 'cognition.console.log'),
  audioTtsLog: resolveDesktopObservabilityPath(PROJECT_ROOTS, 'logs', 'application', 'audio-tts.console.log'),
  audioAsrLog: resolveDesktopObservabilityPath(PROJECT_ROOTS, 'logs', 'application', 'audio-asr.console.log'),
  avatarHostLog: AVATAR_PATHS.processLogPath,
  avatarHostBuildLog: AVATAR_PATHS.buildLogPath,
  avatarHostPackage: AVATAR_PATHS.packageDir,
  avatarSdkPackage: AVATAR_PATHS.sdkPackageDir,
};

const CHARACTER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;
const EXTENSION_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PROFILE_ROOT_PATTERN = /^[a-z0-9](?:[a-z0-9_-]|\/[a-z0-9][a-z0-9_-]*)*$/;

interface ActiveExtensionSelection {
  id: string;
  version: string;
}

const SYSTEM_IDENTITY_FILE = resolveDesktopConfigChildPath(PROJECT_ROOTS, 'system', 'identity.yaml');
const AVATAR_SETTINGS_FILE = resolveDesktopConfigChildPath(PROJECT_ROOTS, 'system', 'avatar.yaml');
const SURFACES_SETTINGS_FILE = resolveDesktopConfigChildPath(PROJECT_ROOTS, 'system', 'surfaces.yaml');
const AUDIO_SETTINGS_FILE = resolveDesktopConfigChildPath(PROJECT_ROOTS, 'system', 'audio.yaml');
const EMBEDDING_SETTINGS_FILE = resolveDesktopConfigChildPath(PROJECT_ROOTS, 'system', 'embedding.yaml');
const EXTENSION_ACTIVE_FILE = resolveDesktopConfigChildPath(PROJECT_ROOTS, 'extensions', 'active.yaml');

async function resolveActiveCharacterConfigDir(): Promise<string> {
  const identity = await loadYamlDocument(SYSTEM_IDENTITY_FILE);
  const activeId = getString(identity, ['character', 'active_id'], '');
  const profileRoot = getString(identity, ['character', 'profile_root'], '');
  if (!CHARACTER_ID_PATTERN.test(activeId) || !PROFILE_ROOT_PATTERN.test(profileRoot)) {
    throw new Error('character.active_id 与 character.profile_root 必须显式配置且路径合法');
  }
  return resolveDesktopConfigChildPath(PROJECT_ROOTS, profileRoot, activeId);
}

async function resolveSettingsFiles(): Promise<{
  manifest: string;
  inference: string;
  providers: string;
  voice: string;
  avatar: string;
  surfaces: string;
  audio: string;
  embedding: string;
}> {
  const characterDir = await resolveActiveCharacterConfigDir();
  return {
    manifest: path.join(characterDir, 'character.manifest.yaml'),
    inference: path.join(characterDir, 'inference.yaml'),
    providers: path.join(characterDir, 'providers.yaml'),
    voice: path.join(characterDir, 'voice.yaml'),
    avatar: AVATAR_SETTINGS_FILE,
    surfaces: SURFACES_SETTINGS_FILE,
    audio: AUDIO_SETTINGS_FILE,
    embedding: EMBEDDING_SETTINGS_FILE,
  };
}

const AVATAR_APPEARANCE_FILE = path.join(
  resolveDesktopStatePath(PROJECT_ROOTS, 'desktop'),
  'avatar-presentation.json',
);
const AVATAR_ACTION_STATE_FILE = resolveDesktopStatePath(PROJECT_ROOTS, 'avatar', 'action-state.json');

const COGNITION_DB_FILE = resolveDesktopStatePath(PROJECT_ROOTS, 'cognition', 'memory', 'memory.db');
const CONVERSATION_DB_FILE = resolveDesktopStatePath(PROJECT_ROOTS, 'cognition', 'conversations', 'conversations.db');
const EXPERIENCE_PACK_ROOT = resolveDesktopStatePath(PROJECT_ROOTS, 'cognition', 'experience', 'packs');
const EPISODE_PROJECTION_DB_FILE = resolveDesktopStatePath(PROJECT_ROOTS, 'cognition', 'projections', 'episodes.db');

const DEFAULT_AVATAR_APPEARANCE: AvatarAppearanceSettings = {
  modelId: '',
  displayScale: 1.2,
  placementId: '',
};

interface AudioInputPayload {
  trace_id?: string;
  audio_id: string;
  audio_data: string;
  mime_type: string;
  duration_ms?: number;
  sample_rate?: number;
}

async function loadYamlDocument(filePath: string): Promise<YAML.Document.Parsed> {
  const source = await fs.readFile(filePath, 'utf8');
  return YAML.parseDocument(source);
}

function resolveConfigChildPath(...segments: string[]): string {
  return resolveDesktopConfigChildPath(PROJECT_ROOTS, ...segments);
}

function requireBetterSqlite3(): SqliteDatabaseConstructor | null {
  try {
    return require('better-sqlite3') as SqliteDatabaseConstructor;
  } catch {
    return null;
  }
}

function readCognitionRows(sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
  return readSqliteRows(COGNITION_DB_FILE, sql, params);
}

function readSqliteRows(filePath: string, sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
  if (!fileExistsSync(filePath)) return [];
  const Database = requireBetterSqlite3();
  if (!Database) return [];
  let db: SqliteDatabase | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    return db.prepare(sql).all(...params)
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function readCognitionValue(sql: string, params: unknown[] = []): Record<string, unknown> | null {
  return readSqliteValue(COGNITION_DB_FILE, sql, params);
}

function readSqliteValue(filePath: string, sql: string, params: unknown[] = []): Record<string, unknown> | null {
  if (!fileExistsSync(filePath)) return null;
  const Database = requireBetterSqlite3();
  if (!Database) return null;
  let db: SqliteDatabase | null = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const row = db.prepare(sql).get(...params);
    return row && typeof row === 'object' ? row as Record<string, unknown> : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function openHttpExternalUrl(rawUrl: string, reason: string): Promise<string> {
  const url = rawUrl.trim();
  if (!url) {
    throw new Error(`${reason} 需要 URL`);
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${reason} 只允许 http/https URL`);
  }
  if (isLocalHttpUrl(parsed)) {
    await assertLocalHttpEndpointReady(parsed, reason);
  }
  await shell.openExternal(parsed.toString());
  return parsed.toString();
}

function isLocalHttpUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

async function assertLocalHttpEndpointReady(url: URL, reason: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason} 指向的本地服务未就绪：${url.toString()}。请先启动对应扩展或检查外部依赖。${detail ? ` (${detail})` : ''}`);
  } finally {
    clearTimeout(timer);
  }
}

async function saveYamlDocument(filePath: string, doc: YAML.Document.Parsed): Promise<void> {
  await fs.writeFile(filePath, doc.toString({ lineWidth: 100 }), 'utf8');
}

async function readAvatarPackageCatalog(): Promise<AvatarPackageCatalogResponse> {
  return loadAvatarPackageCatalog(REPO_ROOT);
}

async function readCharacterPresentationProjection(): Promise<CharacterPresentationProjectionPayload> {
  if (lastCharacterPresentationProjection) {
    return lastCharacterPresentationProjection;
  }

  const [catalog, appearance] = await Promise.all([
    readAvatarPackageCatalog(),
    readAvatarAppearance(),
  ]);
  const avatarPackage = resolveAvatarPackage(catalog, appearance.modelId);
  return {
    avatar_package_id: avatarPackage.id,
    model_id: avatarPackage.modelId,
    display_name: avatarPackage.displayName,
    kind: avatarPackage.kind,
    backend: avatarPackage.preferredBackend,
    host_kind: 'offline',
    avatar_state: 'pending',
    appearance: {
      placement_id: appearance.placementId || undefined,
      display_scale: appearance.displayScale,
    },
    lifecycle: {
      worker_window_state: 'unknown',
      composition_surface_state: 'unknown',
      first_frame_presented: false,
      interaction_ready: false,
      ready: false,
      summary: '等待 Kernel 投影与 Unity Avatar 准备完成',
    },
  };
}

async function resolveDefaultAvatarAppearance(): Promise<AvatarAppearanceSettings> {
  try {
    const catalog = await readAvatarPackageCatalog();
    return {
      modelId: catalog.defaultModelId,
      displayScale: DEFAULT_AVATAR_APPEARANCE.displayScale,
      placementId: DEFAULT_AVATAR_APPEARANCE.placementId,
    };
  } catch {
    return DEFAULT_AVATAR_APPEARANCE;
  }
}

async function readAvatarAppearance(): Promise<AvatarAppearanceSettings> {
  try {
    const source = await fs.readFile(AVATAR_APPEARANCE_FILE, 'utf8');
    const payload = normalizeAvatarAppearance(JSON.parse(source));
    handlerOptions.onAvatarAppearanceChanged?.(payload);
    return payload;
  } catch {
    const fallback = await resolveDefaultAvatarAppearance();
    handlerOptions.onAvatarAppearanceChanged?.(fallback);
    return fallback;
  }
}

async function saveAvatarAppearance(raw: unknown): Promise<AvatarAppearanceSettings> {
  const payload = normalizeAvatarAppearance(raw);
  await fs.mkdir(path.dirname(AVATAR_APPEARANCE_FILE), { recursive: true });
  await fs.writeFile(
    AVATAR_APPEARANCE_FILE,
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  handlerOptions.onAvatarAppearanceChanged?.(payload);
  sendToRenderer('ui:avatar-appearance', payload);
  sendAvatarPresentation(payload);
  return payload;
}

function normalizeAvatarAppearance(raw: unknown): AvatarAppearanceSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_AVATAR_APPEARANCE;
  }

  const value = raw as Record<string, unknown>;
  const modelId = typeof value.modelId === 'string' && value.modelId.trim().length > 0
    ? value.modelId.trim()
    : DEFAULT_AVATAR_APPEARANCE.modelId;
  const displayScale = typeof value.displayScale === 'number'
    ? value.displayScale
    : Number(value.displayScale);

  const placementId = typeof value.placementId === 'string'
    ? value.placementId.trim()
    : DEFAULT_AVATAR_APPEARANCE.placementId;

  return {
    modelId,
    displayScale: clamp(displayScale, 0.5, 2.5),
    placementId,
  };
}

async function readAvatarActionState(): Promise<AvatarActionStateSnapshot> {
  try {
    const source = await fs.readFile(AVATAR_ACTION_STATE_FILE, 'utf8');
    lastAvatarActionState = normalizeAvatarActionStateDocument(JSON.parse(source));
  } catch {
    lastAvatarActionState = normalizeAvatarActionState(lastAvatarActionState);
  }
  return lastAvatarActionState;
}

async function saveAvatarActionState(raw: unknown): Promise<AvatarActionStateSnapshot> {
  const payload = normalizeAvatarActionState(raw);
  const document: AvatarActionStateDocument = {
    active_action_ids: payload.activeActionIds,
  };
  lastAvatarActionState = payload;
  await fs.mkdir(path.dirname(AVATAR_ACTION_STATE_FILE), { recursive: true });
  await fs.writeFile(
    AVATAR_ACTION_STATE_FILE,
    `${JSON.stringify(document, null, 2)}\n`,
    'utf8',
  );
  sendToRenderer('ui:avatar-action-state', payload);
  return payload;
}

function normalizeAvatarActionState(raw: unknown): AvatarActionStateSnapshot {
  if (!raw || typeof raw !== 'object') {
    return { activeActionIds: [] };
  }

  const value = raw as Record<string, unknown>;
  const activeActionIds = Array.isArray(value.activeActionIds)
    ? value.activeActionIds
    : Array.isArray(value.active_action_ids)
      ? value.active_action_ids
      : [];
  const actionId = typeof value.actionId === 'string'
    ? value.actionId.trim()
    : typeof value.action_id === 'string'
      ? value.action_id.trim()
      : '';
  const state = value.state === 'inactive'
    || value.state === 'active'
    || value.state === 'running'
    || value.state === 'completed'
    || value.state === 'rejected'
    ? value.state
    : undefined;
  const message = typeof value.message === 'string' ? value.message : undefined;

  return {
    ...(actionId ? { actionId } : {}),
    ...(state ? { state } : {}),
    activeActionIds: uniqueStringList(activeActionIds),
    ...(message ? { message } : {}),
  };
}

function normalizeAvatarActionStateDocument(raw: unknown): AvatarActionStateSnapshot {
  if (!raw || typeof raw !== 'object') {
    return { activeActionIds: [] };
  }
  const document = raw as Partial<AvatarActionStateDocument>;
  return {
    activeActionIds: uniqueStringList(document.active_action_ids ?? []),
  };
}

function uniqueStringList(values: unknown[]): string[] {
  return Array.from(new Set(values
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())));
}

function applyAvatarActionIntent(
  current: AvatarActionStateSnapshot,
  action: AvatarManualAction,
  operation: AvatarActionIntentRequest['operation'],
  actions: AvatarManualAction[],
): AvatarActionStateSnapshot {
  if (!action.toggle || operation === 'trigger') {
    return current;
  }

  const active = new Set(current.activeActionIds);
  if (operation === 'activate') {
    const missing = action.requires.find((requirement) => !active.has(requirement));
    if (missing) {
      const requiredAction = actions.find((item) => item.id === missing);
      throw new Error(`请先开启 ${requiredAction?.label ?? missing}`);
    }

    if (action.exclusiveGroup) {
      const conflict = actions.find((item) => (
        item.id !== action.id
        && item.exclusiveGroup === action.exclusiveGroup
        && active.has(item.id)
      ));
      if (conflict) {
        throw new Error(`${action.label} 与 ${conflict.label} 不能同时开启`);
      }
    }

    active.add(action.id);
  } else {
    const dependent = actions.find((item) => item.requires.includes(action.id) && active.has(item.id));
    if (dependent) {
      throw new Error(`请先关闭 ${dependent.label}`);
    }
    active.delete(action.id);
  }

  return {
    actionId: action.id,
    state: operation === 'activate' ? 'active' : 'inactive',
    activeActionIds: Array.from(active),
  };
}

/** Control Center 只提交语义呈现请求，实际身体由 Kernel 转发给正式 Avatar。 */
function sendAvatarPresentation(appearance: AvatarAppearanceSettings, resetPlacement = false): void {
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    return;
  }

  kernelSocket.send(JSON.stringify({
    kind: 'avatar_presentation',
    timestamp: Date.now(),
    avatar_presentation: {
      placement_id: appearance.placementId || undefined,
      display_scale: appearance.displayScale,
      reset_placement: resetPlacement || undefined,
    },
  }));
}

/** 模型动作始终从本机 catalog 投影读取，renderer 只获得已净化的可操作清单。 */
async function readAvatarManualActions(): Promise<AvatarManualAction[]> {
  const appearance = await readAvatarAppearance();
  const catalog = await readAvatarPackageCatalog();
  const avatarPackage = resolveAvatarPackage(catalog, appearance.modelId);
  const actionsPath = avatarPackage.actionsPath ?? '';
  if (!actionsPath) {
    return [];
  }

  const resolved = resolveRepoAssetPath(REPO_ROOT, actionsPath, `${avatarPackage.id}.actionsPath`);

  const document = await readJsonFile<{ actions?: Array<Record<string, unknown>> }>(resolved);
  return (document?.actions ?? []).flatMap((raw) => {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!id || !label) {
      return [];
    }
    return [{
      id,
      label,
      category: typeof raw.category === 'string' ? raw.category : 'expression',
      manualOnly: raw.manualOnly === true,
      toggle: raw.toggle === true,
      requires: Array.isArray(raw.requires)
        ? raw.requires.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [],
      exclusiveGroup: typeof raw.exclusiveGroup === 'string' && raw.exclusiveGroup.trim().length > 0
        ? raw.exclusiveGroup.trim()
        : undefined,
    }];
  });
}

async function sendAvatarActionIntent(raw: unknown): Promise<void> {
  if (kernelSocket?.readyState !== WebSocket.OPEN || !raw || typeof raw !== 'object') {
    throw new Error('Avatar 尚未连接');
  }

  const value = raw as Record<string, unknown>;
  const actionId = typeof value.id === 'string' ? value.id.trim() : '';
  const operation = value.operation;
  if (!actionId || (operation !== 'trigger' && operation !== 'activate' && operation !== 'deactivate')) {
    throw new Error('无效的形象动作');
  }
  const action = (await readAvatarManualActions()).find((item) => item.id === actionId);
  if (!action) {
    throw new Error('当前模型未声明该动作');
  }
  if ((action.toggle && operation === 'trigger') || (!action.toggle && operation !== 'trigger')) {
    throw new Error('动作操作与模型声明不匹配');
  }

  const actions = await readAvatarManualActions();
  const nextActionState = applyAvatarActionIntent(
    await readAvatarActionState(),
    action,
    operation,
    actions,
  );

  kernelSocket.send(JSON.stringify({
    kind: 'avatar_intent',
    timestamp: Date.now(),
    avatar_intent: {
      action_id: actionId,
      operation,
      priority: 8,
    },
  }));

  if (operation !== 'trigger') {
    await saveAvatarActionState(nextActionState);
  }
}

function getString(doc: YAML.Document.Parsed, pathInDoc: Array<string | number>, fallback: string): string {
  const value = doc.getIn(pathInDoc);
  return typeof value === 'string' ? value : fallback;
}

function getNumber(doc: YAML.Document.Parsed, pathInDoc: Array<string | number>, fallback: number): number {
  const value = doc.getIn(pathInDoc);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getBoolean(doc: YAML.Document.Parsed, pathInDoc: Array<string | number>, fallback: boolean): boolean {
  const value = doc.getIn(pathInDoc);
  return typeof value === 'boolean' ? value : fallback;
}

function getStringArray(doc: YAML.Document.Parsed, pathInDoc: Array<string | number>): string[] {
  const value = doc.getIn(pathInDoc, true);
  if (YAML.isSeq(value)) {
    return value.items
      .map((item) => YAML.isScalar(item) ? item.value : undefined)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  return [];
}

function resolveRepoPath(rawPath: string, fallback = ''): string {
  return resolveDesktopProjectPath(PROJECT_ROOTS, rawPath, fallback);
}

async function pathExists(filePath: string): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const source = await fs.readFile(filePath, 'utf8');
  return JSON.parse(source) as T;
}

function readStringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function assertExtensionId(extensionId: string): void {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error('无效的扩展 ID');
  }
}

async function readActiveExtensionSelections(): Promise<ActiveExtensionSelection[]> {
  try {
    const doc = await loadYamlDocument(EXTENSION_ACTIVE_FILE);
    const parsed = doc.toJS() as { active?: unknown } | null;
    if (!Array.isArray(parsed?.active)) return [];
    const unique = new Map<string, ActiveExtensionSelection>();
    for (const item of parsed.active) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const version = typeof record.version === 'string' ? record.version.trim() : '';
      if (EXTENSION_ID_PATTERN.test(id) && EXTENSION_VERSION_PATTERN.test(version) && !unique.has(id)) {
        unique.set(id, { id, version });
      }
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function readExtensionContributionSnapshot(projection: ExtensionRuntimeProjection | undefined): ExtensionContributionSnapshot {
  const nodes = projection?.capability_graph.nodes ?? [];
  const actions = projection?.actions ?? [];
  const settings = nodes
    .filter((node) => node.contribution_point === 'glimmer.setting')
    .map((node): ExtensionSettingContribution => {
      const type = typeof node.metadata.type === 'string' ? node.metadata.type : 'unknown';
      return {
        key: typeof node.metadata.key === 'string' ? node.metadata.key : node.id,
        title: node.title,
        description: node.description ?? '',
        type: ['string', 'number', 'boolean', 'object', 'array'].includes(type)
          ? type as ExtensionSettingContribution['type']
          : 'unknown',
        defaultValue: node.metadata.default,
      };
    });
  const skills = nodes
    .filter((node) => node.contribution_point === 'glimmer.skill')
    .map((node): ExtensionSkillContribution => {
      const policy = node.metadata.policy && typeof node.metadata.policy === 'object' && !Array.isArray(node.metadata.policy)
        ? node.metadata.policy as Record<string, unknown>
        : {};
      return {
        id: node.id,
        name: typeof node.metadata.name === 'string' ? node.metadata.name : node.title,
        description: node.description ?? '',
        toolCount: Array.isArray(node.metadata.tools) ? node.metadata.tools.length : 0,
        resourceCount: Array.isArray(node.metadata.resources) ? node.metadata.resources.length : 0,
        promptCount: Array.isArray(node.metadata.prompts) ? node.metadata.prompts.length : 0,
        riskLevel: typeof policy.riskLevel === 'string' ? policy.riskLevel : 'low',
        confirmationRequired: policy.confirmationRequired === true,
      };
    });
  const views = nodes
    .filter((node) => node.contribution_point === 'glimmer.view' || node.contribution_point === 'glimmer.managementSurface')
    .map((node): ExtensionViewContribution => ({
      id: node.id,
      title: node.title,
      when: node.state,
    }));
  return {
    commands: actions
      .filter((action) => action.action_kind === 'command')
      .map((action): ExtensionCommandContribution => ({
        command: typeof action.metadata.command === 'string' ? action.metadata.command : action.id,
        title: action.label,
        category: typeof action.metadata.category === 'string' ? action.metadata.category : '',
        state: action.state,
        disabledReason: action.disabled_reason,
      })),
    settings,
    skills,
    views,
  };
}

function readExtensionDependencySnapshot(
  projection: ExtensionRuntimeProjection | undefined,
): ExtensionDependencySnapshot[] {
  const nodes = projection?.capability_graph.nodes ?? [];
  return nodes
    .filter((node) => (
      node.contribution_point === 'glimmer.managedResource'
      || node.contribution_point === 'glimmer.protocolBridge'
    ))
    .map((node): ExtensionDependencySnapshot => {
      const packageDir = typeof node.metadata.package_dir === 'string' ? node.metadata.package_dir : '';
      const tone: ExtensionDependencyTone = node.state === 'ready' || node.state === 'live'
        ? 'ready'
        : node.required
          ? 'missing'
          : 'optional';
      const healthState: ExtensionDependencyHealthState = node.state === 'ready' || node.state === 'live'
        ? 'ready'
        : node.state === 'failed' || node.state === 'degraded'
          ? 'unavailable'
          : 'unknown';
      const firstGate = node.readiness_gates[0];
      return {
        id: node.id,
        displayName: node.title,
        kind: node.kind,
        required: node.required,
        description: node.description ?? '',
        installDir: packageDir,
        resolvedInstallDir: packageDir,
        tone,
        health: {
          state: healthState,
          label: node.state,
          summary: node.summary,
          endpoint: typeof node.metadata.endpoint === 'string' ? node.metadata.endpoint : firstGate?.endpoint,
          checkedAt: Date.parse(firstGate?.checked_at ?? node.updated_at) || Date.now(),
        },
      };
    });
}

function resolveExtensionConfigPath(extensionId: string): string {
  assertExtensionId(extensionId);
  return resolveDesktopConfigChildPath(PROJECT_ROOTS, 'extensions', `${extensionId}.yaml`);
}

function toExtensionRuntimeProjectionSnapshot(
  projection: ExtensionRuntimeProjection | undefined,
): ExtensionRuntimeProjectionSnapshot | undefined {
  if (!projection) return undefined;
  return {
    schema: projection.schema,
    state: mapHostLifecycleToExtensionState(projection.lifecycle),
    summary: projection.summary || projection.diagnostics.summary || '',
    updatedAt: projection.updated_at,
    details: projection as unknown as Record<string, unknown>,
  };
}

function mapHostLifecycleToExtensionState(
  lifecycle: ExtensionRuntimeProjection['lifecycle'],
): ExtensionRuntimeProjectionSnapshot['state'] {
  if (lifecycle === 'running') return 'ready';
  if (lifecycle === 'starting' || lifecycle === 'degraded') return 'degraded';
  if (lifecycle === 'stopped' || lifecycle === 'loaded' || lifecycle === 'discovered') return 'stopped';
  if (lifecycle === 'failed') return 'error';
  return 'unknown';
}

function resolveExtensionOperationalState(
  extension: {
    enabled: boolean;
    logState: ExtensionLogState;
    dependencies: ExtensionDependencySnapshot[];
    runtimeProjection?: ExtensionRuntimeProjectionSnapshot;
  },
): Pick<ExtensionManagementItem, 'operationalState' | 'operationalSummary' | 'running'> {
  if (!extension.enabled) {
    return { running: false, operationalState: 'disabled', operationalSummary: '扩展未启用。' };
  }
  if (extension.runtimeProjection) {
    const summary = extension.runtimeProjection.summary || '扩展运行投影已更新。';
    if (extension.runtimeProjection.state === 'ready') {
      return { running: true, operationalState: 'ready', operationalSummary: summary };
    }
    if (extension.runtimeProjection.state === 'error') {
      return { running: true, operationalState: 'error', operationalSummary: summary };
    }
    if (extension.runtimeProjection.state === 'stopped') {
      return { running: false, operationalState: 'stopped', operationalSummary: summary };
    }
    if (extension.runtimeProjection.state === 'degraded' || extension.runtimeProjection.state === 'starting') {
      return { running: true, operationalState: 'degraded', operationalSummary: summary };
    }
  }
  return { running: false, operationalState: 'stopped', operationalSummary: '等待 Extension Host 上报运行投影。' };
}

function logStateFromHostProjection(projection: ExtensionRuntimeProjection | undefined): ExtensionLogState {
  if (!projection) {
    return { lastEvent: 'unknown', message: '等待 Extension Host 上报运行投影。', timestamp: '' };
  }
  const lifecycle = projection.lifecycle;
  const lastEvent: ExtensionLogState['lastEvent'] = lifecycle === 'failed'
    ? 'error'
    : lifecycle === 'running'
      ? 'started'
      : lifecycle === 'stopped'
        ? 'stopped'
        : lifecycle === 'loaded'
          ? 'loaded'
          : 'unknown';
  return {
    lastEvent,
    message: projection.summary || projection.diagnostics.summary,
    timestamp: projection.updated_at,
  };
}

function isExtensionRuntimeProjection(value: unknown): value is ExtensionRuntimeProjection {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.schema === 'glimmer-cradle.extension.runtime-projection'
    && typeof data.extension_id === 'string'
    && typeof data.lifecycle === 'string'
    && Array.isArray(data.contribution_points)
    && data.capability_graph !== null
    && typeof data.capability_graph === 'object'
    && Array.isArray((data.capability_graph as Record<string, unknown>).nodes)
    && Array.isArray((data.capability_graph as Record<string, unknown>).edges)
    && Array.isArray(data.actions)
    && typeof data.updated_at === 'string';
}

function replaceExtensionRuntimeProjectionCache(projections: ExtensionRuntimeProjection[]): void {
  lastExtensionRuntimeProjections = projections
    .slice()
    .sort((left, right) => left.extension_id.localeCompare(right.extension_id));
}

function upsertExtensionRuntimeProjectionCache(projection: ExtensionRuntimeProjection): void {
  const next = new Map(lastExtensionRuntimeProjections.map((item) => [item.extension_id, item]));
  next.set(projection.extension_id, projection);
  replaceExtensionRuntimeProjectionCache(Array.from(next.values()));
}

async function readExtensionManagementSnapshot(): Promise<ExtensionManagementSnapshot> {
  const [activeSelections, projectionResponse] = await Promise.all([
    readActiveExtensionSelections(),
    requestExtensionRuntimeProjections(),
  ]);
  const projections = projectionResponse.status === 'success'
    ? projectionResponse.projections
    : lastExtensionRuntimeProjections;
  const installations = projectionResponse.status === 'success'
    ? projectionResponse.installations
    : lastExtensionInstallationProjections;
  const enabledSet = new Set(activeSelections.map(({ id }) => id));
  const installationsById = new Map(
    installations.map((installation) => [installation.extension_id, installation]),
  );
  const projectionsById = new Map(
    projections.map((projection) => [projection.extension_id, projection]),
  );
  const extensions = await Promise.all(Array.from(projectionsById.values()).map(async (hostProjection): Promise<ExtensionManagementItem> => {
    const id = hostProjection.extension_id.trim();
    const contributions = readExtensionContributionSnapshot(hostProjection);
    const configPath = resolveExtensionConfigPath(id);
    const configYaml = await pathExists(configPath) ? await fs.readFile(configPath, 'utf8') : '';
    const dependencies = readExtensionDependencySnapshot(hostProjection);
    const logState = logStateFromHostProjection(hostProjection);
    const runtimeProjection = toExtensionRuntimeProjectionSnapshot(hostProjection);
    const operational = resolveExtensionOperationalState({
      enabled: enabledSet.has(id),
      logState,
      dependencies,
      runtimeProjection,
    });
    const installation = installationsById.get(id);
    return {
      id,
      name: hostProjection.display_name || id,
      version: hostProjection.version ?? '',
      installedVersions: installation?.installed_versions ?? (hostProjection.version ? [hostProjection.version] : []),
      activeVersion: installation?.active_version ?? '',
      description: hostProjection.description ?? '',
      enabled: enabledSet.has(id),
      running: operational.running,
      permissions: readStringArrayValue(hostProjection.permissions),
      tags: readStringArrayValue(hostProjection.tags),
      commands: contributions.commands,
      contributions,
      configPath,
      configYaml,
      dependencies,
      logState,
      operationalState: operational.operationalState,
      operationalSummary: operational.operationalSummary,
      ...(runtimeProjection ? { runtimeProjection } : {}),
    };
  }));

  return {
    extensionRoot: EXTENSION_ROOT,
    activeConfigPath: EXTENSION_ACTIVE_FILE,
    extensions: extensions
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function prepareExtensionInstall(raw: unknown): Promise<ExtensionInstallPreview> {
  assertObject(raw);
  const sourceKind = readString(raw, 'kind');
  let source: ExtensionInstallPrepareRequest['source'];
  if (sourceKind === 'local_file') {
    const options: OpenDialogOptions = {
      title: '选择 Glimmer Cradle 扩展包',
      properties: ['openFile'],
      filters: [{ name: 'Glimmer Cradle Extension', extensions: ['gcex'] }],
    };
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return { request_id: `extension-install-${Date.now()}`, status: 'error', message: '已取消选择扩展包' };
    }
    source = { kind: 'file', path: result.filePaths[0] };
  } else if (sourceKind === 'release_manifest') {
    source = { kind: 'release_manifest', url: readString(raw, 'url') };
  } else if (sourceKind === 'registry') {
    source = {
      kind: 'registry',
      catalog_url: readString(raw, 'catalogUrl'),
      extension_id: readString(raw, 'extensionId'),
      channel: normalizeExtensionChannel(raw.channel),
    };
  } else if (sourceKind === 'repository') {
    source = {
      kind: 'repository',
      repository: readString(raw, 'repository'),
      tag: readString(raw, 'tag'),
    };
  } else {
    throw new Error('无效的扩展安装来源');
  }

  const requestId = `extension-install-prepare-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return sendExtensionInstallRequest<ExtensionInstallPreview>(
    requestId,
    extensionInstallPreviewWaiters,
    {
      kind: 'extension_install_prepare',
      timestamp: Date.now(),
      extension_install_prepare: { request_id: requestId, source },
    },
  );
}

async function commitExtensionInstall(raw: unknown): Promise<ExtensionInstallResult> {
  assertObject(raw);
  const requestId = `extension-install-commit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request: ExtensionInstallCommitRequest = {
    request_id: requestId,
    transaction_id: readString(raw, 'transactionId'),
    approved_permissions: readStringArrayValue(raw.approvedPermissions),
  };
  const result = await sendExtensionInstallRequest<ExtensionInstallResult>(
    requestId,
    extensionInstallResultWaiters,
    { kind: 'extension_install_commit', timestamp: Date.now(), extension_install_commit: request },
  );
  if (result.status === 'success') await requestExtensionRuntimeProjections();
  return result;
}

async function cancelExtensionInstall(raw: unknown): Promise<ExtensionInstallResult> {
  assertObject(raw);
  const requestId = `extension-install-cancel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return sendExtensionInstallRequest<ExtensionInstallResult>(
    requestId,
    extensionInstallResultWaiters,
    {
      kind: 'extension_install_cancel',
      timestamp: Date.now(),
      extension_install_cancel: { request_id: requestId, transaction_id: readString(raw, 'transactionId') },
    },
  );
}

async function uninstallExtension(raw: unknown): Promise<ExtensionUninstallResult> {
  assertObject(raw);
  const requestId = `extension-uninstall-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const extensionId = readString(raw, 'extensionId');
  assertExtensionId(extensionId);
  const version = readString(raw, 'version');
  const result = await sendExtensionInstallRequest<ExtensionUninstallResult>(
    requestId,
    extensionUninstallWaiters,
    {
      kind: 'extension_uninstall_request',
      timestamp: Date.now(),
      extension_uninstall_request: { request_id: requestId, extension_id: extensionId, version },
    },
  );
  if (result.status === 'success') await requestExtensionRuntimeProjections();
  return result;
}

function sendExtensionInstallRequest<T>(
  requestId: string,
  waiters: Map<string, { resolve: (result: T) => void; timer: ReturnType<typeof setTimeout> }>,
  frame: PresentationUpstreamFrame,
): Promise<T> {
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Kernel 尚未连接，无法管理扩展包。'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(requestId);
      reject(new Error('扩展包管理请求超时'));
    }, 120000);
    waiters.set(requestId, { resolve, timer });
    kernelSocket?.send(JSON.stringify(frame));
  });
}

function normalizeExtensionChannel(value: unknown): 'stable' | 'beta' | 'nightly' {
  return value === 'beta' || value === 'nightly' ? value : 'stable';
}

async function saveExtensionConfig(raw: unknown): Promise<ExtensionManagementSnapshot> {
  assertObject(raw);
  const extensionId = readString(raw, 'extensionId');
  assertExtensionId(extensionId);
  const configYaml = readString(raw, 'configYaml');
  YAML.parseDocument(configYaml);
  const configPath = resolveExtensionConfigPath(extensionId);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, configYaml.endsWith('\n') ? configYaml : `${configYaml}\n`, 'utf8');
  return readExtensionManagementSnapshot();
}

function requestExtensionLifecycle(raw: ExtensionLifecycleRequest): Promise<ExtensionLifecycleResult> {
  const extensionId = raw.extensionId.trim();
  assertExtensionId(extensionId);
  const operation = raw.operation;
  const version = raw.version?.trim() ?? '';
  if (operation !== 'start' && operation !== 'stop') {
    throw new Error('无效的扩展生命周期操作');
  }
  if (version && !EXTENSION_VERSION_PATTERN.test(version)) {
    throw new Error('无效的扩展版本');
  }
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Kernel 尚未连接，配置已保存但无法热启动或热关闭扩展。'));
  }

  const requestId = `extension-${operation}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      extensionLifecycleWaiters.delete(requestId);
      void appendDesktopAuditRecord(PROJECT_ROOTS, {
        action: `extension.lifecycle.${operation}`,
        target_kind: 'extension',
        target_name: extensionId,
        extension_id: extensionId,
        trace_id: requestId,
        outcome: 'timeout',
        duration_ms: Date.now() - startedAt,
      });
      reject(new Error('扩展生命周期请求超时'));
    }, 15000);
    extensionLifecycleWaiters.set(requestId, {
      timer,
      resolve: (result) => {
        clearTimeout(timer);
        if (result.status === 'error') {
          void appendDesktopAuditRecord(PROJECT_ROOTS, {
            action: `extension.lifecycle.${operation}`,
            target_kind: 'extension',
            target_name: extensionId,
            extension_id: extensionId,
            trace_id: requestId,
            outcome: 'failed',
            reason: result.message || '扩展生命周期操作失败',
            duration_ms: Date.now() - startedAt,
          });
          reject(new Error(result.message || '扩展生命周期操作失败'));
        } else {
          void appendDesktopAuditRecord(PROJECT_ROOTS, {
            action: `extension.lifecycle.${operation}`,
            target_kind: 'extension',
            target_name: extensionId,
            extension_id: extensionId,
            trace_id: requestId,
            outcome: 'succeeded',
            duration_ms: Date.now() - startedAt,
          });
          resolve(result);
        }
      },
    });
    kernelSocket?.send(JSON.stringify({
      kind: 'extension_lifecycle_request',
      timestamp: Date.now(),
      extension_lifecycle_request: {
        request_id: requestId,
        extension_id: extensionId,
        version: operation === 'start' && version ? version : undefined,
        operation,
      },
    }));
  });
}

function executeExtensionCommand(raw: ExtensionCommandRequest): Promise<ExtensionCommandResult> {
  const commandId = String(raw.commandId ?? '').trim();
  if (!/^[a-z0-9][a-z0-9_-]*[.:][a-zA-Z0-9_.:-]+$/.test(commandId)) {
    throw new Error('无效的扩展命令 ID');
  }
  const args = Array.isArray(raw.args) ? raw.args : [];
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Kernel 尚未连接，无法执行扩展命令。'));
  }

  const requestId = `extension-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      extensionCommandWaiters.delete(requestId);
      void appendDesktopAuditRecord(PROJECT_ROOTS, {
        action: 'extension.command.execute',
        target_kind: 'extension_command',
        target_name: commandId,
        trace_id: requestId,
        outcome: 'timeout',
        duration_ms: Date.now() - startedAt,
      });
      reject(new Error('扩展命令请求超时'));
    }, 15000);
    extensionCommandWaiters.set(requestId, {
      timer,
      resolve: (result) => {
        clearTimeout(timer);
        if (result.status === 'error') {
          void appendDesktopAuditRecord(PROJECT_ROOTS, {
            action: 'extension.command.execute',
            target_kind: 'extension_command',
            target_name: commandId,
            trace_id: requestId,
            outcome: 'failed',
            reason: result.message || '扩展命令执行失败',
            duration_ms: Date.now() - startedAt,
          });
          reject(new Error(result.message || '扩展命令执行失败'));
        } else {
          finalizeExtensionCommandResult(result).then((finalized) => {
            void appendDesktopAuditRecord(PROJECT_ROOTS, {
              action: 'extension.command.execute',
              target_kind: 'extension_command',
              target_name: commandId,
              trace_id: requestId,
              outcome: 'succeeded',
              duration_ms: Date.now() - startedAt,
            });
            resolve(finalized);
          }).catch(reject);
        }
      },
    });
    kernelSocket?.send(JSON.stringify({
      kind: 'extension_command_request',
      timestamp: Date.now(),
      extension_command_request: {
        request_id: requestId,
        command_id: commandId,
        args,
      },
    }));
  });
}

function requestExtensionRuntimeProjections(): Promise<ExtensionRuntimeProjectionResponse> {
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    return Promise.resolve({
      status: 'error',
      projections: lastExtensionRuntimeProjections,
      installations: lastExtensionInstallationProjections,
      message: 'Kernel 尚未连接，无法读取 Host 运行投影。',
    });
  }

  const requestId = `extension-runtime-projection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      extensionRuntimeProjectionWaiters.delete(requestId);
      resolve({
        status: 'error',
        projections: lastExtensionRuntimeProjections,
        installations: lastExtensionInstallationProjections,
        message: '扩展运行投影请求超时',
      });
    }, 10000);
    extensionRuntimeProjectionWaiters.set(requestId, {
      timer,
      resolve: (result) => {
        clearTimeout(timer);
        if (result.status === 'success') {
          replaceExtensionRuntimeProjectionCache(result.projections);
          lastExtensionInstallationProjections = result.installations;
        }
        resolve(result);
      },
    });
    kernelSocket?.send(JSON.stringify({
      kind: 'extension_runtime_projection_request',
      timestamp: Date.now(),
      extension_runtime_projection_request: { request_id: requestId },
    }));
  });
}

async function finalizeExtensionCommandResult(result: ExtensionCommandResult): Promise<ExtensionCommandResult> {
  const url = extractExtensionResultUrl(result.result);
  if (!url) return result;
  const openedUrl = await openHttpExternalUrl(url, '扩展命令返回的 URL');
  void appendDesktopAuditRecord(PROJECT_ROOTS, {
    action: 'extension.command.open_url',
    target_kind: 'url',
    target_name: openedUrl,
    trace_id: openedUrl,
    outcome: 'succeeded',
  });
  const originalResult = result.result && typeof result.result === 'object'
    ? result.result as Record<string, unknown>
    : { value: result.result };
  return {
    ...result,
    message: result.message || '已打开链接。',
    result: {
      ...originalResult,
      url: openedUrl,
      opened: true,
    },
  };
}

function extractExtensionResultUrl(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const value = result as Record<string, unknown>;
  const candidate = value.openUrl ?? value.url;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function requestSkillCatalog(): Promise<SkillCatalogResponse> {
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    return Promise.resolve({
      status: 'error',
      message: 'Kernel 尚未连接，无法读取能力目录。',
    });
  }

  const requestId = `skill-catalog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      skillCatalogWaiters.delete(requestId);
      resolve({
        status: 'error',
        message: '能力目录请求超时',
      });
    }, 10000);
    skillCatalogWaiters.set(requestId, {
      timer,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
    });
    kernelSocket?.send(JSON.stringify({
      kind: 'skill_catalog_request',
      request_id: requestId,
      timestamp: Date.now(),
    }));
  });
}

async function collectAvatarSdkArtifacts(directory: string, extensions: Set<string>): Promise<number> {
  if (!(await pathExists(directory))) return 0;
  let count = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await collectAvatarSdkArtifacts(entryPath, extensions);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      count += 1;
    }
  }
  return count;
}

async function readAvatarSdkDiagnostics(): Promise<AvatarSdkDiagnosticsSnapshot[]> {
  const avatarCatalog = await readAvatarPackageCatalog();
  const sdkCatalog = await readJsonFile<{ sdks?: Array<Record<string, unknown>> }>(
    AVATAR_PATHS.sdkCatalogPath,
  );
  const requiredModelFormats = new Set(
    avatarCatalog.packages
      .filter((avatarPackage) => avatarPackage.preferredBackend === 'unity')
      .map((avatarPackage) => avatarPackage.live2dVersion)
      .filter((value): value is 'cubism4' | 'cubism5' => value === 'cubism4' || value === 'cubism5'),
  );

  const diagnostics: AvatarSdkDiagnosticsSnapshot[] = [];
  const resolvedSdkIds = new Set<string>();
  for (const modelFormat of requiredModelFormats) {
    const descriptor = (sdkCatalog.sdks ?? []).find(
      (sdk) => readStringArrayValue(sdk.modelFormats).includes(modelFormat),
    );
    if (!descriptor) {
      diagnostics.push({
        id: modelFormat,
        displayName: modelFormat,
        modelFormats: [modelFormat],
        status: 'missing-catalog',
        sourcePath: '',
        resolvedSourcePath: '',
        targetPath: '',
        installed: false,
        artifactCount: 0,
        installHint: `avatar-sdk-catalog.json 未声明支持 ${modelFormat} 的 SDK。`,
        licenseNote: '',
      });
      continue;
    }

    const descriptorId = typeof descriptor.id === 'string' ? descriptor.id : modelFormat;
    if (resolvedSdkIds.has(descriptorId)) continue;
    resolvedSdkIds.add(descriptorId);

    const sourceEnv = typeof descriptor.sourceEnv === 'string' ? descriptor.sourceEnv : undefined;
    const sourceEnvValue = sourceEnv ? process.env[sourceEnv] : undefined;
    const sourcePath = typeof descriptor.sourcePath === 'string' ? descriptor.sourcePath : '';
    const targetPath = typeof descriptor.targetPath === 'string' ? descriptor.targetPath : '';
    const resolvedSourcePath = resolveRepoPath(sourceEnvValue || sourcePath);
    const resolvedTargetPath = resolveRepoPath(targetPath);
    const installMode = typeof descriptor.installMode === 'string' ? descriptor.installMode : 'copy';
    const importMarkerPath = typeof descriptor.importMarkerPath === 'string'
      ? resolveRepoPath(descriptor.importMarkerPath)
      : resolvedTargetPath;
    const extensions = new Set(readStringArrayValue(descriptor.artifactExtensions).map((item) => item.toLowerCase()));
    const artifactCount = await collectAvatarSdkArtifacts(resolvedSourcePath, extensions);
    const installed = installMode === 'unitypackage'
      ? await pathExists(importMarkerPath)
      : artifactCount > 0;

    diagnostics.push({
      id: descriptorId,
      displayName: typeof descriptor.displayName === 'string' ? descriptor.displayName : descriptorId,
      modelFormats: readStringArrayValue(descriptor.modelFormats),
      status: typeof descriptor.status === 'string' ? descriptor.status : 'supported',
      sourcePath,
      sourceEnv,
      sourceEnvValue,
      resolvedSourcePath,
      targetPath: resolvedTargetPath,
      installed,
      artifactCount,
      installHint: typeof descriptor.installHint === 'string'
        ? descriptor.installHint
        : '把兼容 SDK 放入声明目录，或通过环境变量指向本机目录。',
      licenseNote: typeof descriptor.licenseNote === 'string' ? descriptor.licenseNote : '',
    });
  }

  return diagnostics;
}

async function readControlCenterSettings(): Promise<ControlCenterSettingsSnapshot> {
  const settingsFiles = await resolveSettingsFiles();
  const [manifest, inference, providers, voice, avatar, surfaces, audio, embedding] = await Promise.all([
    loadYamlDocument(settingsFiles.manifest),
    loadYamlDocument(settingsFiles.inference),
    loadYamlDocument(settingsFiles.providers),
    loadYamlDocument(settingsFiles.voice),
    loadYamlDocument(settingsFiles.avatar),
    loadYamlDocument(settingsFiles.surfaces),
    loadYamlDocument(settingsFiles.audio),
    loadYamlDocument(settingsFiles.embedding),
  ]);
  const nickname = getString(manifest, ['base', 'nickname'], '').trim();
  if (!nickname) {
    throw new Error('Character Package 缺少 base.nickname');
  }
  const providerRoot = providers.toJS() as Record<string, unknown>;
  const providerMap = providerRoot.providers && typeof providerRoot.providers === 'object'
    ? providerRoot.providers as Record<string, unknown>
    : {};
  const providerItems = Object.entries(providerMap).flatMap(([id, rawProvider]) => {
    if (!rawProvider || typeof rawProvider !== 'object') return [];
    const item = rawProvider as Record<string, unknown>;
    const models = item.models && typeof item.models === 'object'
      ? item.models as Record<string, unknown>
      : {};
    return [{
      id,
      apiType: typeof item.api_type === 'string' ? item.api_type : 'openai',
      baseUrl: typeof item.base_url === 'string' ? item.base_url : '',
      temperature: typeof item.temperature === 'number' ? item.temperature : 0.7,
      models: {
        chat: typeof models.chat === 'string' ? models.chat : typeof models.text === 'string' ? models.text : '',
        reasoner: typeof models.reasoner === 'string' ? models.reasoner : '',
        vision: typeof models.vision === 'string' ? models.vision : '',
        audio: typeof models.audio === 'string' ? models.audio : '',
      },
    }];
  });
  const rootApiType = getString(providers, ['api_type'], 'deepseek');
  const rootBaseUrl = getString(providers, ['base_url'], '');
  const rootChatModel = getString(providers, ['models', 'chat'], '');
  const activeProvider = providerItems.find((item) => (
    item.apiType === rootApiType
    && item.baseUrl === rootBaseUrl
    && (!rootChatModel || item.models.chat === rootChatModel)
  )) ?? providerItems.find((item) => item.id === rootApiType) ?? providerItems[0];
  if (providerItems.length === 0) {
    providerItems.push({
      id: rootApiType,
      apiType: rootApiType,
      baseUrl: rootBaseUrl,
      temperature: getNumber(providers, ['temperature'], 0.7),
      models: { chat: rootChatModel, reasoner: '', vision: '', audio: '' },
    });
  }

  return {
    inference: {
      maxTokens: getNumber(inference, ['model', 'max_tokens'], 1024),
      temperature: getNumber(inference, ['model', 'temperature'], 0.8),
      topP: getNumber(inference, ['model', 'top_p'], 0.9),
    },
    lifeClock: {
      heartbeatEnabled: getBoolean(inference, ['life_clock', 'heartbeat_enabled'], false),
      heartbeatIntervalMs: getNumber(inference, ['life_clock', 'heartbeat_interval_ms'], 45000),
      focusDurationMs: getNumber(inference, ['life_clock', 'focus_duration_ms'], 20000),
      ingressDebounceMs: getNumber(inference, ['life_clock', 'ingress_debounce_ms'], 1400),
      focusOnAnyChat: getBoolean(inference, ['life_clock', 'focus_on_any_chat'], false),
      summonKeywords: getStringArray(inference, ['life_clock', 'summon_keywords']),
    },
    embedding: {
      enabled: getBoolean(embedding, ['enabled'], false),
      provider: getString(embedding, ['route', 'provider'], 'dashscope-text-embedding'),
      cloudModel: getString(embedding, ['providers', 'dashscope-text-embedding', 'model'], 'text-embedding-v4'),
      dimensions: getNumber(embedding, ['providers', 'dashscope-text-embedding', 'dimensions'], 1024),
      autoDownload: getBoolean(embedding, ['providers', 'local-sentence-transformers', 'auto_download'], false),
      device: getString(embedding, ['providers', 'local-sentence-transformers', 'device'], 'cpu'),
      modelPath: getString(embedding, ['providers', 'local-sentence-transformers', 'model_path'], ''),
      modelId: getString(embedding, ['providers', 'local-sentence-transformers', 'model_id'], ''),
    },
    modelServices: {
      activeProviderId: activeProvider?.id ?? providerItems[0].id,
      providers: providerItems,
    },
    persona: {
      nickname,
      personaMode: getString(manifest, ['persona_mode'], 'api'),
    },
    avatar: {
      enabled: getBoolean(avatar, ['enabled'], true),
    },
    audio: {
      ttsEnabled: getBoolean(audio, ['tts', 'enabled'], false),
      asrEnabled: getBoolean(audio, ['asr', 'enabled'], false),
      cloudVoiceId: getString(voice, ['bindings', 'dashscope-cosyvoice', 'voice_id'], ''),
    },
  };
}

async function readAvatarDiagnostics(): Promise<AvatarDiagnosticsSnapshot> {
  const avatar = await loadYamlDocument(AVATAR_SETTINGS_FILE);
  const enabled = getBoolean(avatar, ['enabled'], true);
  const launchMode = getString(avatar, ['host', 'launch_mode'], 'managed');
  const command = getString(
    avatar,
    ['host', 'command'],
    AVATAR_PATHS.managedCommand,
  );
  const cwd = getString(
    avatar,
    ['host', 'cwd'],
    AVATAR_PATHS.managedWorkingDir,
  );
  const commandPath = resolveRepoPath(command);
  const unityProjectPath = AVATAR_PATHS.unityProjectPath;
  const avatarPackageDir = AVATAR_PATHS.packageDir;
  const avatarSdkPackageDir = AVATAR_PATHS.sdkPackageDir;
  const assetRegistryPath = AVATAR_PATHS.packageRegistryPath;
  const buildLogPath = AVATAR_PATHS.buildLogPath;
  const processLogPath = AVATAR_PATHS.processLogPath;
  const [commandExists, assetRegistryExists] = await Promise.all([
    pathExists(commandPath),
    pathExists(assetRegistryPath),
  ]);
  const requiredSdks = await readAvatarSdkDiagnostics();
  const unpreparedSdks = requiredSdks.filter(
    (sdk) => !sdk.installed && sdk.artifactCount === 0,
  );
  const pendingImportSdks = requiredSdks.filter(
    (sdk) => !sdk.installed && sdk.artifactCount > 0,
  );

  let tone: AvatarReadinessTone = 'ready';
  let summary = 'Unity Avatar 已具备受管启动条件';
  let nextAction = '运行 pnpm dev 后由 Kernel 自动拉起 Avatar。';

  if (!enabled) {
    tone = 'warn';
    summary = 'Avatar 已在配置中关闭';
    nextAction = '在配置页启用 Avatar 后重启 Glimmer Cradle。';
  } else if (launchMode !== 'managed') {
    tone = 'warn';
    summary = 'Avatar 当前不是受管启动模式';
    nextAction = '将 launch_mode 设为 managed，或手动启动 UnityAvatarHost 调试。';
  } else if (!assetRegistryExists) {
    tone = 'error';
    summary = 'Unity 资产投影尚未生成';
    nextAction = '运行 pnpm sync:unity-assets。';
  } else if (unpreparedSdks.length > 0) {
    tone = 'error';
    summary = `缺少 Avatar SDK 安装包：${unpreparedSdks.map((sdk) => sdk.displayName).join('、')}`;
    nextAction = unpreparedSdks[0]?.installHint ?? '准备 Avatar SDK 后运行 pnpm avatar:sync。';
  } else if (pendingImportSdks.length > 0) {
    tone = 'warn';
    summary = 'Avatar SDK 安装包已准备，等待 Unity 导入';
    nextAction = '安装兼容的 Unity Editor 后运行 pnpm avatar:build。';
  } else if (!commandExists) {
    tone = 'error';
    summary = 'Unity Avatar 构建产物不存在';
    nextAction = '运行 pnpm avatar:build 生成 UnityAvatarHost。';
  }

  return {
    enabled,
    launchMode,
    command,
    cwd,
    commandPath,
    commandExists,
    unityProjectPath,
    avatarPackageDir,
    avatarSdkPackageDir,
    assetRegistryPath,
    assetRegistryExists,
    buildLogPath,
    processLogPath,
    requiredSdks,
    tone,
    summary,
    nextAction,
  };
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('配置载荷必须是对象');
  }
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = value[key];
  assertObject(child);
  return child;
}

function readFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  const raw = value[key];
  const numberValue = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new Error(`配置项 ${key} 必须在 ${min}~${max} 之间`);
  }
  return numberValue;
}

function readInteger(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number {
  return Math.round(readFiniteNumber(value, key, min, max));
}

function readString(value: Record<string, unknown>, key: string, fallback = ''): string {
  const raw = value[key];
  if (raw === undefined || raw === null) return fallback;
  return String(raw).trim();
}

function readBoolean(value: Record<string, unknown>, key: string): boolean {
  return Boolean(value[key]);
}

function readKeywords(value: Record<string, unknown>): string[] {
  const raw = value.summonKeywords;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item).trim())
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index)
    .slice(0, 16);
}

function readEmbeddingProvider(value: Record<string, unknown>): string {
  const provider = readString(value, 'provider', 'dashscope-text-embedding');
  if (!['dashscope-text-embedding', 'local-sentence-transformers'].includes(provider)) {
    throw new Error('Embedding Provider 不受支持');
  }
  return provider;
}

function readEmbeddingDimensions(value: Record<string, unknown>): number {
  const dimensions = readInteger(value, 'dimensions', 64, 2048);
  if (![64, 128, 256, 512, 768, 1024, 1536, 2048].includes(dimensions)) {
    throw new Error('Embedding 向量维度不受支持');
  }
  return dimensions;
}

function readModelProviders(value: Record<string, unknown>): ControlCenterSettingsSnapshot['modelServices'] {
  const activeProviderId = readString(value, 'activeProviderId', '');
  const rawProviders = value.providers;
  if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
    throw new Error('至少需要配置一个模型 Provider');
  }
  const ids = new Set<string>();
  const providers = rawProviders.map((rawProvider) => {
    assertObject(rawProvider);
    const models = readRecord(rawProvider, 'models');
    const id = readString(rawProvider, 'id', '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
      throw new Error('Provider ID 只能使用小写字母、数字、点、短横线和下划线');
    }
    if (ids.has(id)) throw new Error(`Provider ID 重复：${id}`);
    ids.add(id);
    return {
      id,
      apiType: readString(rawProvider, 'apiType', 'openai') || 'openai',
      baseUrl: readString(rawProvider, 'baseUrl', ''),
      temperature: readFiniteNumber(rawProvider, 'temperature', 0, 2),
      models: {
        chat: readString(models, 'chat', ''),
        reasoner: readString(models, 'reasoner', ''),
        vision: readString(models, 'vision', ''),
        audio: readString(models, 'audio', ''),
      },
    };
  });
  if (!ids.has(activeProviderId)) {
    throw new Error('当前模型 Provider 必须来自 Provider 列表');
  }
  return { activeProviderId, providers };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AVATAR_APPEARANCE.displayScale;
  return Math.max(min, Math.min(max, value));
}

function normalizeSettingsPayload(raw: unknown): ControlCenterSettingsSnapshot {
  assertObject(raw);
  const inference = readRecord(raw, 'inference');
  const lifeClock = readRecord(raw, 'lifeClock');
  const embedding = readRecord(raw, 'embedding');
  const modelServices = readRecord(raw, 'modelServices');
  const persona = readRecord(raw, 'persona');
  const avatar = readRecord(raw, 'avatar');
  const surfaces = readRecord(raw, 'surfaces');
  const audio = readRecord(raw, 'audio');
  const nickname = readString(persona, 'nickname', '').trim();
  if (!nickname) {
    throw new Error('persona.nickname 不能为空');
  }

  return {
    inference: {
      maxTokens: readInteger(inference, 'maxTokens', 64, 8192),
      temperature: readFiniteNumber(inference, 'temperature', 0, 2),
      topP: readFiniteNumber(inference, 'topP', 0, 1),
    },
    lifeClock: {
      heartbeatEnabled: readBoolean(lifeClock, 'heartbeatEnabled'),
      heartbeatIntervalMs: readInteger(lifeClock, 'heartbeatIntervalMs', 1000, 600000),
      focusDurationMs: readInteger(lifeClock, 'focusDurationMs', 1000, 600000),
      ingressDebounceMs: readInteger(lifeClock, 'ingressDebounceMs', 0, 60000),
      focusOnAnyChat: readBoolean(lifeClock, 'focusOnAnyChat'),
      summonKeywords: readKeywords(lifeClock),
    },
    embedding: {
      enabled: readBoolean(embedding, 'enabled'),
      provider: readEmbeddingProvider(embedding),
      cloudModel: readString(embedding, 'cloudModel', 'text-embedding-v4'),
      dimensions: readEmbeddingDimensions(embedding),
      autoDownload: readBoolean(embedding, 'autoDownload'),
      device: readString(embedding, 'device', 'cpu') || 'cpu',
      modelPath: readString(embedding, 'modelPath', ''),
      modelId: readString(embedding, 'modelId', ''),
    },
    modelServices: readModelProviders(modelServices),
    persona: {
      nickname,
      personaMode: readString(persona, 'personaMode', 'api') || 'api',
    },
    avatar: {
      enabled: readBoolean(avatar, 'enabled'),
    },
    audio: {
      ttsEnabled: readBoolean(audio, 'ttsEnabled'),
      asrEnabled: readBoolean(audio, 'asrEnabled'),
      cloudVoiceId: readString(audio, 'cloudVoiceId', ''),
    },
  };
}

async function saveControlCenterSettings(raw: unknown): Promise<void> {
  const payload = normalizeSettingsPayload(raw);
  const settingsFiles = await resolveSettingsFiles();
  const [manifest, inference, providers, voice, avatar, surfaces, audio, embedding] = await Promise.all([
    loadYamlDocument(settingsFiles.manifest),
    loadYamlDocument(settingsFiles.inference),
    loadYamlDocument(settingsFiles.providers),
    loadYamlDocument(settingsFiles.voice),
    loadYamlDocument(settingsFiles.avatar),
    loadYamlDocument(settingsFiles.surfaces),
    loadYamlDocument(settingsFiles.audio),
    loadYamlDocument(settingsFiles.embedding),
  ]);

  inference.setIn(['model', 'max_tokens'], payload.inference.maxTokens);
  inference.setIn(['model', 'temperature'], payload.inference.temperature);
  inference.setIn(['model', 'top_p'], payload.inference.topP);
  inference.setIn(['life_clock', 'heartbeat_enabled'], payload.lifeClock.heartbeatEnabled);
  inference.setIn(['life_clock', 'heartbeat_interval_ms'], payload.lifeClock.heartbeatIntervalMs);
  inference.deleteIn(['life_clock', 'focused_interval_ms']);
  inference.deleteIn(['life_clock', 'ambient_interval_ms']);
  inference.deleteIn(['life_clock', 'default_mode']);
  inference.deleteIn(['life_clock', 'active_thought_modes']);
  inference.setIn(['life_clock', 'focus_duration_ms'], payload.lifeClock.focusDurationMs);
  inference.setIn(['life_clock', 'ingress_debounce_ms'], payload.lifeClock.ingressDebounceMs);
  inference.setIn(['life_clock', 'focus_on_any_chat'], payload.lifeClock.focusOnAnyChat);
  inference.setIn(['life_clock', 'summon_keywords'], payload.lifeClock.summonKeywords);
  inference.deleteIn(['embedding']);
  embedding.setIn(['enabled'], payload.embedding.enabled);
  embedding.setIn(['route', 'provider'], payload.embedding.provider);
  embedding.setIn(['providers', 'dashscope-text-embedding', 'model'], payload.embedding.cloudModel);
  embedding.setIn(['providers', 'dashscope-text-embedding', 'dimensions'], payload.embedding.dimensions);
  embedding.setIn(['providers', 'local-sentence-transformers', 'auto_download'], payload.embedding.autoDownload);
  embedding.setIn(['providers', 'local-sentence-transformers', 'device'], payload.embedding.device);
  embedding.setIn(['providers', 'local-sentence-transformers', 'model_path'], payload.embedding.modelPath);
  embedding.setIn(['providers', 'local-sentence-transformers', 'model_id'], payload.embedding.modelId);

  const activeProvider = payload.modelServices.providers.find(
    (provider) => provider.id === payload.modelServices.activeProviderId,
  );
  if (!activeProvider) throw new Error('当前模型 Provider 不存在');
  providers.setIn(['api_type'], activeProvider.apiType);
  providers.setIn(['base_url'], activeProvider.baseUrl);
  providers.setIn(['temperature'], activeProvider.temperature);
  providers.setIn(['models'], { chat: activeProvider.models.chat });
  providers.setIn(['providers'], Object.fromEntries(payload.modelServices.providers.map((provider) => [
    provider.id,
    {
      api_type: provider.apiType,
      base_url: provider.baseUrl,
      temperature: provider.temperature,
      models: Object.fromEntries(Object.entries(provider.models).filter(([, value]) => value.length > 0)),
    },
  ])));

  manifest.setIn(['base', 'nickname'], payload.persona.nickname);
  manifest.setIn(['persona_mode'], payload.persona.personaMode);

  avatar.setIn(['enabled'], payload.avatar.enabled);
  audio.setIn(['tts', 'enabled'], payload.audio.ttsEnabled);
  audio.setIn(['asr', 'enabled'], payload.audio.asrEnabled);
  voice.setIn(['bindings', 'dashscope-cosyvoice', 'voice_id'], payload.audio.cloudVoiceId);

  await Promise.all([
    saveYamlDocument(settingsFiles.manifest, manifest),
    saveYamlDocument(settingsFiles.inference, inference),
    saveYamlDocument(settingsFiles.providers, providers),
    saveYamlDocument(settingsFiles.voice, voice),
    saveYamlDocument(settingsFiles.avatar, avatar),
    saveYamlDocument(settingsFiles.surfaces, surfaces),
    saveYamlDocument(settingsFiles.audio, audio),
    saveYamlDocument(settingsFiles.embedding, embedding),
  ]);
}

async function readMemoryPreview(): Promise<MemoryArchitectureSnapshot> {
  const [
    experienceItems,
    memoryItems,
    conversationItems,
    knowledgeItems,
    activeMemoryCount,
    conversationMessageCount,
    experienceCount,
    episodeCounts,
    consolidationCounts,
    knowledgeCount,
    revisionCount,
    evidenceLinkCount,
  ] = await Promise.all([
    readRecentExperiencePreview(8),
    readMemoryRevisionPreview(5),
    readConversationPreview(8),
    readKnowledgePreview(5),
    readActiveMemoryCount(),
    readConversationMessageCount(),
    readExperienceRecordCount(),
    readEpisodeCounts(),
    readConsolidationCounts(),
    readKnowledgeCount(),
    readMemoryRevisionCount(),
    readMemoryEvidenceLinkCount(),
  ]);
  const items = [...conversationItems, ...experienceItems, ...memoryItems, ...knowledgeItems].slice(0, 16);
  return {
    updatedAt: Date.now(),
    items,
    metrics: {
      previewItems: items.length,
      conversationMessages: conversationMessageCount,
      experienceMoments: experienceCount,
      episodes: episodeCounts.total,
      pendingConsolidationEpisodes: episodeCounts.pendingConsolidation,
      completedConsolidations: consolidationCounts.completed,
      emptyConsolidations: consolidationCounts.empty,
      failedConsolidations: consolidationCounts.failed,
      activeMemories: activeMemoryCount,
      memoryRevisions: revisionCount,
      memoryEvidenceLinks: evidenceLinkCount,
      knowledgeEntries: knowledgeCount,
      durableRecords: experienceCount + activeMemoryCount,
      previewedMemories: memoryItems.length,
      sourceNotes: buildMemoryProjectionNotes({
        conversationMessageCount,
        experienceCount,
        activeMemoryCount,
        knowledgeCount,
        evidenceLinkCount,
        consolidationCounts,
      }),
    },
  };
}

async function readRecentExperiencePreview(limit: number): Promise<MemoryArchitectureItem[]> {
  const packFiles = await listExperiencePackFiles();
  return packFiles
    .flatMap((filePath) => readSqliteRows(
      filePath,
      `SELECT moment_id, position, kind, content_json, actor_name, occurred_at
       FROM moments
       ORDER BY position DESC
       LIMIT ?`,
      [limit],
    ))
    .sort((left, right) => Number(right.position || 0) - Number(left.position || 0))
    .flatMap((row): MemoryArchitectureItem[] => {
      const item = parseExperiencePreviewRow(row);
      return item ? [item] : [];
    })
    .slice(0, limit);
}

function parseExperiencePreviewRow(raw: Record<string, unknown>): MemoryArchitectureItem | null {
  try {
    const kind = typeof raw.kind === 'string' ? raw.kind : 'Moment';
    const content = typeof raw.content_json === 'string'
      ? JSON.parse(raw.content_json) as Record<string, unknown>
      : {};
    const body = extractExperienceText(kind, content);
    if (!body) return null;
    const actorName = typeof raw.actor_name === 'string' ? raw.actor_name : '';
    return {
      id: typeof raw.moment_id === 'string' ? raw.moment_id : `experience-${String(raw.position ?? Date.now())}`,
      source: 'experience_moment',
      title: experienceKindLabel(kind, actorName),
      body: compactPreviewText(body),
      timestamp: typeof raw.occurred_at === 'string' ? raw.occurred_at : undefined,
    };
  } catch {
    return null;
  }
}

function extractExperienceText(kind: string, content: Record<string, unknown>): string {
  const direct = readMeaningfulText(content.text)
    || readMeaningfulText(content.summary)
    || readMeaningfulText(content.reply_text)
    || readMeaningfulText(content.message);
  if (direct) return direct;
  if (kind === 'thought' || kind === 'emotion' || kind === 'silence') return '';
  return '';
}

function readMeaningfulText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /^\[mock\]/i.test(text)) return '';
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/u.test(text)) return '';
  return text;
}

function experienceKindLabel(kind: string, actorName: string): string {
  if (kind === 'perception') {
    return actorName.trim() || '感知输入';
  }
  if (kind === 'reply') return '角色回复';
  if (kind === 'action_result') return '能力执行结果';
  return kind;
}

async function readMemoryRevisionPreview(limit: number): Promise<MemoryArchitectureItem[]> {
  const rows = readCognitionRows(
    `SELECT item.memory_id, item.kind, item.status, item.updated_at,
            revision.revision_id, revision.content, revision.summary
     FROM memory_items AS item
     JOIN memory_revisions AS revision ON revision.revision_id = item.current_revision_id
     WHERE item.status IN ('active', 'disputed')
     ORDER BY item.updated_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.flatMap((row, index): MemoryArchitectureItem[] => {
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!content) return [];
    const memoryType = typeof row.kind === 'string' && row.kind.trim().length > 0 ? row.kind.trim() : 'memory';
    return [{
      id: typeof row.revision_id === 'string' ? row.revision_id : `memory-revision-${index}`,
      source: 'memory_revision',
      title: memoryType,
      body: compactPreviewText(typeof row.summary === 'string' && row.summary.trim() ? row.summary : content),
      timestamp: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    }];
  });
}

async function readKnowledgePreview(limit: number): Promise<MemoryArchitectureItem[]> {
  const projectedItems = readCognitionKnowledgePreview(limit);
  if (projectedItems.length > 0) return projectedItems;

  try {
    const characterDir = await resolveActiveCharacterConfigDir();
    const knowledgeDir = path.join(characterDir, 'knowledge');
    const indexPath = path.join(knowledgeDir, 'index.yaml');
    const index = await loadYamlDocument(indexPath);
    const entries = index.get('entries');
    if (!Array.isArray(entries)) return [];
    const items: MemoryArchitectureItem[] = [];
    for (const [index, entry] of entries.slice(0, limit).entries()) {
      if (!entry || typeof entry !== 'object') continue;
      const value = entry as Record<string, unknown>;
      const entryId = typeof value.entry_id === 'string' ? value.entry_id : `knowledge-${index}`;
      const title = typeof value.title === 'string' ? value.title : entryId;
      const fileName = typeof value.file === 'string' ? value.file : '';
      const body = fileName
        ? await readKnowledgeFilePreview(knowledgeDir, fileName)
        : '';
      items.push({
        id: entryId,
        source: 'role_knowledge',
        title,
        body: body || '知识条目尚未写入正文。',
      });
    }
    return items;
  } catch {
    return [];
  }
}

function readConversationPreview(limit: number): MemoryArchitectureItem[] {
  const rows = readSqliteRows(
    CONVERSATION_DB_FILE,
    `SELECT moment_id, conversation_id, role, content, actor_name, occurred_at
     FROM conversation_messages
     ORDER BY position DESC
     LIMIT ?`,
    [limit],
  );
  return rows.flatMap((row, index): MemoryArchitectureItem[] => {
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!content) return [];
    const role = typeof row.role === 'string' ? row.role : '';
    const actorName = typeof row.actor_name === 'string' ? row.actor_name.trim() : '';
    return [{
      id: typeof row.moment_id === 'string' ? row.moment_id : `conversation-message-${index}`,
      source: 'conversation_message',
      title: role === 'assistant' ? '角色回复' : actorName || '用户消息',
      body: compactPreviewText(content),
      timestamp: typeof row.occurred_at === 'string' ? row.occurred_at : undefined,
    }];
  });
}

function readConversationMessageCount(): number {
  const row = readSqliteValue(CONVERSATION_DB_FILE, 'SELECT COUNT(*) AS count FROM conversation_messages');
  const count = row?.count;
  return typeof count === 'number' ? count : Number(count || 0);
}

async function readExperienceRecordCount(): Promise<number> {
  const packFiles = await listExperiencePackFiles();
  return packFiles.reduce((count, filePath) => {
    const row = readSqliteValue(filePath, 'SELECT COUNT(*) AS count FROM moments');
    return count + Number(row?.count || 0);
  }, 0);
}

async function readKnowledgeCount(): Promise<number> {
  const row = readCognitionValue('SELECT COUNT(*) AS count FROM knowledge_entry WHERE enabled != 0');
  if (row) {
    const count = row.count;
    return typeof count === 'number' ? count : Number(count || 0);
  }

  try {
    const characterDir = await resolveActiveCharacterConfigDir();
    const indexPath = path.join(characterDir, 'knowledge', 'index.yaml');
    const index = await loadYamlDocument(indexPath);
    const entries = index.get('entries');
    return Array.isArray(entries) ? entries.length : 0;
  } catch {
    return 0;
  }
}

async function readEpisodeCounts(): Promise<{ total: number; pendingConsolidation: number }> {
  const total = Number(readSqliteValue(EPISODE_PROJECTION_DB_FILE, 'SELECT COUNT(*) AS count FROM episodes')?.count || 0);
  const pendingConsolidation = Number(readSqliteValue(
    EPISODE_PROJECTION_DB_FILE,
    "SELECT COUNT(*) AS count FROM episodes WHERE status = 'sealed' AND consolidated_at IS NULL",
  )?.count || 0);
  return { total, pendingConsolidation };
}

function readConsolidationCounts(): { completed: number; empty: number; failed: number } {
  const row = readCognitionValue(
    `SELECT
       SUM(CASE WHEN run.status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN run.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN run.status = 'completed' AND NOT EXISTS (
         SELECT 1
         FROM memory_revisions AS revision
         WHERE revision.consolidation_id = run.consolidation_id
       ) THEN 1 ELSE 0 END) AS empty
     FROM consolidation_runs AS run`,
  );
  return {
    completed: Number(row?.completed || 0),
    empty: Number(row?.empty || 0),
    failed: Number(row?.failed || 0),
  };
}

function buildMemoryProjectionNotes(input: {
  conversationMessageCount: number;
  experienceCount: number;
  activeMemoryCount: number;
  knowledgeCount: number;
  evidenceLinkCount: number;
  consolidationCounts: { completed: number; empty: number; failed: number };
}): string[] {
  const notes: string[] = [];
  if (input.conversationMessageCount > 0) {
    notes.push('会话记录是由 Experience Ledger 重建的查询投影，可用于连续对话，但不等同于长期记忆。');
  }
  if (input.experienceCount > 0) {
    notes.push('经历 Moment 已进入不可变 Ledger，可作为 Episode 投影、记忆巩固与审计证据。');
  }
  if (input.activeMemoryCount === 0) {
    notes.push('当前没有活动记忆；会话记录、经历 Moment 和角色知识不会被冒充为长期记忆。');
  }
  if (input.consolidationCounts.empty > 0) {
    notes.push(`已有 ${input.consolidationCounts.empty} 次 Episode 巩固判定为无长期记忆价值；任务已完成，但不会生成 Memory revision。`);
  }
  if (input.consolidationCounts.failed > 0) {
    notes.push(`有 ${input.consolidationCounts.failed} 次 Episode 巩固失败并保留待重试。`);
  }
  if (input.activeMemoryCount > 0 && input.evidenceLinkCount === 0) {
    notes.push('活动记忆缺少证据链接，请检查 Episode 巩固链路。');
  }
  if (input.knowledgeCount > 0) {
    notes.push('角色知识是稳定资料来源，不等同于长期记忆。');
  }
  return notes;
}

function readCognitionKnowledgePreview(limit: number): MemoryArchitectureItem[] {
  const rows = readCognitionRows(
    `SELECT entry_id, content, priority, updated_at
     FROM knowledge_entry
     WHERE enabled != 0
     ORDER BY priority DESC, updated_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.flatMap((row, index): MemoryArchitectureItem[] => {
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!content) return [];
    return [{
      id: typeof row.entry_id === 'string' ? row.entry_id : `knowledge-${index}`,
      source: 'role_knowledge',
      title: typeof row.entry_id === 'string' ? row.entry_id : '知识条目',
      body: compactPreviewText(content),
      timestamp: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    }];
  });
}

async function readKnowledgeFilePreview(knowledgeDir: string, fileName: string): Promise<string> {
  const root = path.resolve(knowledgeDir);
  const target = path.resolve(root, fileName);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  try {
    const source = await fs.readFile(target, 'utf8');
    const text = source
      .split(/\r?\n/)
      .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
      .filter(Boolean)
      .join(' ');
    return compactPreviewText(text);
  } catch {
    return '';
  }
}

async function readActiveMemoryCount(): Promise<number> {
  const row = readCognitionValue("SELECT COUNT(*) AS count FROM memory_items WHERE status IN ('active', 'disputed')");
  const count = row?.count;
  return typeof count === 'number' ? count : Number(count || 0);
}

async function readMemoryRevisionCount(): Promise<number> {
  return Number(readCognitionValue('SELECT COUNT(*) AS count FROM memory_revisions')?.count || 0);
}

async function readMemoryEvidenceLinkCount(): Promise<number> {
  return Number(readCognitionValue('SELECT COUNT(*) AS count FROM memory_evidence')?.count || 0);
}

async function listExperiencePackFiles(): Promise<string[]> {
  try {
    const yearEntries = await fs.readdir(EXPERIENCE_PACK_ROOT, { withFileTypes: true });
    const packs = await Promise.all(yearEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const yearDir = path.join(EXPERIENCE_PACK_ROOT, entry.name);
        return (await fs.readdir(yearDir, { withFileTypes: true }))
          .filter((file) => file.isFile() && file.name.endsWith('.experience.db'))
          .map((file) => path.join(yearDir, file.name));
      }));
    return packs.flat();
  } catch {
    return [];
  }
}

function compactPreviewText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function setConnectionStatus(status: KernelConnectionStatus): void {
  currentConnectionStatus = status;
  sendToRenderer('ui:connection-status', { status });
}

async function connectToKernel(): Promise<void> {
  if (
    kernelSocket?.readyState === WebSocket.OPEN
    || kernelSocket?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  try {
    const endpoint = await resolveKernelWsEndpoint();
    if (!endpoint) {
      setConnectionStatus('offline');
      scheduleReconnect();
      return;
    }
    kernelWsUrl = endpoint;
    kernelSocket = new WebSocket(endpoint, { maxPayload: 2 * 1024 * 1024 });
  } catch {
    setConnectionStatus('offline');
    scheduleReconnect();
    return;
  }

  kernelSocket.on('open', () => {
    console.log('[ipc-bridge] Connected to kernel WebSocket');
    hasConnectedToKernel = true;
    waitingForKernelLogged = false;
    setConnectionStatus('online');
    void readAvatarAppearance().then((appearance) => sendAvatarPresentation(appearance));
  });

  kernelSocket.on('message', (raw: WebSocket.RawData) => {
    try {
      const frame = JSON.parse(raw.toString());
      const kindValue: string = (typeof frame.kind === 'string' && frame.kind) || '';
      const traceId: string = (typeof frame.trace_id === 'string' && frame.trace_id) || '';

      if (kindValue === 'extension_install_preview') {
        const result = frame.extension_install_preview as ExtensionInstallPreview | undefined;
        const waiter = result ? extensionInstallPreviewWaiters.get(result.request_id) : undefined;
        if (result && waiter) {
          extensionInstallPreviewWaiters.delete(result.request_id);
          clearTimeout(waiter.timer);
          waiter.resolve(result);
        }
        return;
      }

      if (kindValue === 'extension_install_result') {
        const result = frame.extension_install_result as ExtensionInstallResult | undefined;
        const waiter = result ? extensionInstallResultWaiters.get(result.request_id) : undefined;
        if (result && waiter) {
          extensionInstallResultWaiters.delete(result.request_id);
          clearTimeout(waiter.timer);
          waiter.resolve(result);
        }
        return;
      }

      if (kindValue === 'extension_uninstall_result') {
        const result = frame.extension_uninstall_result as ExtensionUninstallResult | undefined;
        const waiter = result ? extensionUninstallWaiters.get(result.request_id) : undefined;
        if (result && waiter) {
          extensionUninstallWaiters.delete(result.request_id);
          clearTimeout(waiter.timer);
          waiter.resolve(result);
        }
        return;
      }

      if (kindValue === 'extension_lifecycle_result') {
        const response = frame.extension_lifecycle_result;
        const requestId = response?.request_id ?? '';
        const waiter = extensionLifecycleWaiters.get(requestId);
        if (waiter) {
          extensionLifecycleWaiters.delete(requestId);
          waiter.resolve({
            status: response.status === 'success' ? 'success' : 'error',
            message: typeof response.message === 'string' ? response.message : '',
          });
        }
        return;
      }

      if (kindValue === 'extension_command_result') {
        const response = frame.extension_command_result;
        const requestId = response?.request_id ?? '';
        const waiter = extensionCommandWaiters.get(requestId);
        if (waiter) {
          extensionCommandWaiters.delete(requestId);
          waiter.resolve({
            status: response.status === 'success' ? 'success' : 'error',
            result: response.result,
            message: typeof response.message === 'string' ? response.message : '',
          });
        }
        return;
      }

      if (kindValue === 'skill_catalog_response') {
        const requestId = typeof frame.request_id === 'string' ? frame.request_id : '';
        const waiter = skillCatalogWaiters.get(requestId);
        if (waiter) {
          skillCatalogWaiters.delete(requestId);
          waiter.resolve({
            status: frame.status === 'success' ? 'success' : 'error',
            snapshot: frame.skill_catalog && typeof frame.skill_catalog === 'object'
              ? frame.skill_catalog as SkillCatalogSnapshot
              : undefined,
            message: typeof frame.message === 'string' ? frame.message : '',
          });
        }
        return;
      }

      if (kindValue === 'extension_runtime_projection_result') {
        const response = frame.extension_runtime_projection_result;
        const requestId = response?.request_id ?? '';
        const waiter = extensionRuntimeProjectionWaiters.get(requestId);
        if (waiter) {
          extensionRuntimeProjectionWaiters.delete(requestId);
          const projections = (response?.projections ?? []).filter(isExtensionRuntimeProjection);
          const installations = response?.installations ?? [];
          waiter.resolve({
            status: response?.status === 'success' ? 'success' : 'error',
            projections,
            installations,
            message: typeof response?.message === 'string' ? response.message : '',
          });
        }
        return;
      }

      if (kindValue === 'extension_runtime_projection_changed') {
        const projection = frame.extension_runtime_projection_changed;
        if (isExtensionRuntimeProjection(projection)) {
          upsertExtensionRuntimeProjectionCache(projection);
          sendToRenderer('ui:extension-status-changed', {
            extensionId: projection.extension_id,
            event: projection.lifecycle === 'failed' ? 'error' : projection.lifecycle === 'running' ? 'started' : projection.lifecycle === 'stopped' ? 'stopped' : 'loaded',
            message: projection.summary,
            timestamp: typeof frame.timestamp === 'number' ? frame.timestamp : Date.now(),
          });
        }
        return;
      }

      if (kindValue === 'extension_status_changed') {
        const payload = frame.extension_status_changed ?? {};
        const extensionId = typeof payload.extension_id === 'string' ? payload.extension_id : '';
        const event = typeof payload.event === 'string' ? payload.event : '';
        if (
          extensionId &&
          (event === 'loaded' || event === 'started' || event === 'stopped' || event === 'error')
        ) {
          const next: ExtensionStatusChangedPayload = {
            extensionId,
            event,
            message: typeof payload.message === 'string' ? payload.message : undefined,
            timestamp: typeof frame.timestamp === 'number' ? frame.timestamp : Date.now(),
          };
          sendToRenderer('ui:extension-status-changed', next);
        }
        return;
      }

      if (kindValue === 'core_skill_action_request') {
        void handleCoreSkillActionRequest(frame);
        return;
      }

      if (kindValue === 'core_skill_confirmation_request') {
        void handleCoreSkillConfirmationRequest(frame);
        return;
      }

      if (!isPresentationFrameKind(kindValue)) {
        if (kindValue) {
          console.warn(`[ipc-bridge] Unknown PresentationFrame kind: ${kindValue}`);
        }
        return;
      }

      const kind = kindValue;
      const frameClass = getPresentationFrameClass(kind);

      if (frameClass === 'expression_flow') {
        if (kind === 'reply') {
          const text: string = frame.reply?.text ?? '';
          sendToRenderer('ui:reply', {
            trace_id: traceId,
            text,
            messages: frame.reply?.messages ?? [],
          });
          const inline = frame.reply?.emotion_snapshot;
          if (inline) {
            sendToRenderer('ui:emotion-update', {
              emotion_type: inline.emotion_type ?? 'neutral',
              intensity: inline.intensity ?? 0.5,
              trigger: inline.trigger ?? '',
              timestamp: new Date().toISOString(),
            });
          }
        } else if (kind === 'emotion') {
          const e = frame.emotion ?? {};
          sendToRenderer('ui:emotion-update', {
            emotion_type: e.emotion_type ?? 'neutral',
            intensity: typeof e.intensity === 'number' ? e.intensity : 0.5,
            trigger: e.trigger ?? '',
            timestamp: new Date().toISOString(),
          });
        } else if (kind === 'thought') {
          const thought = frame.thought ?? {};
          sendToRenderer('ui:thought-update', {
            trace_id: traceId,
            active: Boolean(thought.active),
            hint: typeof thought.hint === 'string' ? thought.hint : '',
            timestamp: new Date().toISOString(),
          });
        }
      } else if (frameClass === 'avatar_control') {
        if (kind === 'audio_play') {
          const a = frame.audio_play ?? frame;
          if (typeof a.audio_id !== 'string' || (!a.audio_uri && !a.audio_data)) {
            return;
          }
          sendAudioToOwner({
            trace_id: traceId,
            audio_id: a.audio_id,
            audio_uri: a.audio_uri,
            audio_data: a.audio_data,
            mime_type: a.mime_type,
            duration_ms: a.duration_ms,
          });
        } else if (kind === 'avatar_action_state' && frame.avatar_action_state) {
          const state = frame.avatar_action_state;
          const nextState = {
            actionId: state.action_id,
            state: state.state,
            activeActionIds: Array.isArray(state.active_action_ids) ? state.active_action_ids : [],
            message: state.message,
          };
          void saveAvatarActionState(nextState).catch((error) => {
            console.warn('[ipc-bridge] Failed to persist avatar action state', error);
            sendToRenderer('ui:avatar-action-state', normalizeAvatarActionState(nextState));
          });
        }
      } else if (frameClass === 'presentation_state') {
        if (kind === 'character_presentation_projection' && frame.character_presentation_projection) {
          lastCharacterPresentationProjection = frame.character_presentation_projection;
          sendToRenderer('ui:character-presentation-projection', lastCharacterPresentationProjection);
        } else if (kind === 'avatar_status') {
          const hostKind = frame.avatar_status?.host_kind ?? frame.hostKind;
          if (hostKind === 'unity' || hostKind === 'offline') {
            handlerOptions.onAvatarStatusChanged?.(hostKind);
            sendToRenderer('ui:avatar-status', { hostKind });
          }
      } else if (kind === 'audio_status' && frame.audio_status) {
          lastAudioStatus = frame.audio_status;
          sendToRenderer('ui:audio-status', lastAudioStatus);
        } else if (kind === 'runtime_readiness' && frame.runtime_readiness) {
          lastRuntimeReadiness = frame.runtime_readiness;
          sendToRenderer('ui:runtime-readiness', lastRuntimeReadiness);
        } else if (kind === 'audio_transcript' && frame.audio_transcript) {
          sendToRenderer('ui:audio-transcript', {
            trace_id: traceId,
            audio_id: frame.audio_transcript.audio_id,
            status: frame.audio_transcript.status,
            text: frame.audio_transcript.text,
            message: frame.audio_transcript.message,
          });
        }
      }
    } catch {
      console.warn('[ipc-bridge] Failed to parse kernel message');
    }
  });

  kernelSocket.on('close', () => {
    if (hasConnectedToKernel) {
      console.log('[ipc-bridge] Kernel WebSocket closed');
    }
    setConnectionStatus('offline');
    kernelSocket = null;
    for (const [requestId, waiter] of extensionLifecycleWaiters) {
      extensionLifecycleWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'error', message: 'Kernel 连接已断开' });
    }
    for (const [requestId, waiter] of extensionCommandWaiters) {
      extensionCommandWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'error', message: 'Kernel 连接已断开' });
    }
    for (const [requestId, waiter] of extensionRuntimeProjectionWaiters) {
      extensionRuntimeProjectionWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'error', projections: [], installations: [], message: 'Kernel 连接已断开' });
    }
    for (const [requestId, waiter] of skillCatalogWaiters) {
      skillCatalogWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'error', message: 'Kernel 连接已断开' });
    }
    for (const [requestId, waiter] of extensionInstallPreviewWaiters) {
      extensionInstallPreviewWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ request_id: requestId, status: 'error', message: 'Kernel 连接已断开' });
    }
    for (const [requestId, waiter] of extensionInstallResultWaiters) {
      extensionInstallResultWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ request_id: requestId, status: 'error', message: 'Kernel 连接已断开' });
    }
    for (const [requestId, waiter] of extensionUninstallWaiters) {
      extensionUninstallWaiters.delete(requestId);
      clearTimeout(waiter.timer);
      waiter.resolve({ request_id: requestId, extension_id: '', version: '', status: 'error', message: 'Kernel 连接已断开' });
    }
    for (const resolve of kernelDisconnectWaiters) resolve();
    kernelDisconnectWaiters.clear();
    if (!kernelShutdownRequested) {
      scheduleReconnect();
    }
  });

  kernelSocket.on('error', (err: NodeJS.ErrnoException) => {
    if (!hasConnectedToKernel && err.code === 'ECONNREFUSED') {
      if (!waitingForKernelLogged) {
        console.log(`[ipc-bridge] Waiting for kernel WebSocket at ${kernelWsUrl}`);
        waitingForKernelLogged = true;
      }
      setConnectionStatus('offline');
    } else {
      console.warn('[ipc-bridge] Kernel WebSocket error:', err.message);
      setConnectionStatus('offline');
    }
    kernelSocket?.close();
    kernelSocket = null;
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer || kernelShutdownRequested) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectToKernel();
  }, RECONNECT_INTERVAL_MS);
}

async function resolveKernelWsEndpoint(): Promise<string | null> {
  const configured = process.env.GLIMMER_CRADLE_DESKTOP_UI_WS_URL?.trim();
  if (configured) return isLoopbackWebSocketEndpoint(configured) ? configured : null;

  try {
    const catalogPath = resolveDesktopRunPath(PROJECT_ROOTS, 'host', 'endpoints.json');
    const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as {
      owner_pid?: unknown;
      endpoints?: Array<{ purpose?: unknown; endpoint?: unknown }>;
    };
    const ownerPid = Number(catalog.owner_pid);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0 || !isProcessAlive(ownerPid)) return null;
    const endpoint = catalog.endpoints?.find((item) => item.purpose === 'control-surface')?.endpoint;
    return typeof endpoint === 'string' && isLoopbackWebSocketEndpoint(endpoint) ? endpoint : null;
  } catch {
    return null;
  }
}

function isLoopbackWebSocketEndpoint(endpoint: string): boolean {
  return /^ws:\/\/(?:127\.0\.0\.1|\[::1\]):\d+$/u.test(endpoint);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sendToRenderer(channel: string, data: unknown): void {
  for (const win of rendererWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

function sendAudioToOwner(data: { audio_id: string } & Record<string, unknown>): void {
  const presence = Array.from(rendererSurfaces.entries()).find(([win, surface]) => (
    surface === 'presence' && !win.isDestroyed()
  ))?.[0];
  const target = presence ?? Array.from(rendererWindows).find((win) => !win.isDestroyed());
  if (!target || deliveredAudioIds.has(data.audio_id)) return;
  deliveredAudioIds.add(data.audio_id);
  if (deliveredAudioIds.size > MAX_DELIVERED_AUDIO_IDS) {
    const oldest = deliveredAudioIds.values().next().value;
    if (typeof oldest === 'string') deliveredAudioIds.delete(oldest);
  }
  target.webContents.send('ui:audio-play', data);
}

async function handleCoreSkillActionRequest(frame: Record<string, unknown>): Promise<void> {
  const requestId = typeof frame.request_id === 'string' ? frame.request_id : '';
  const traceId = typeof frame.trace_id === 'string' ? frame.trace_id : requestId;
  const action = typeof frame.action === 'string' ? frame.action : '';
  const payload = frame.payload && typeof frame.payload === 'object'
    ? frame.payload as Record<string, unknown>
    : {};

  try {
    const startedAt = Date.now();
    let result: unknown;
    if (action === 'desktop.open_url') {
      const url = typeof payload.url === 'string' ? payload.url.trim() : '';
      const openedUrl = await openHttpExternalUrl(url, 'desktop.open_url');
      result = { ok: true, url: openedUrl };
    } else if (action === 'notification.show') {
      const title = typeof payload.title === 'string' ? payload.title.trim() : '';
      const body = typeof payload.body === 'string' ? payload.body.trim() : '';
      if (!title || !body) {
        throw new Error('notification.show 需要 title 与 body');
      }
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
      result = { ok: true, shown: Notification.isSupported() };
    } else if (action === 'clipboard.read') {
      result = { ok: true, text: clipboard.readText() };
    } else if (action === 'clipboard.write') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      clipboard.writeText(text);
      result = { ok: true };
    } else {
      throw new Error(`未知 Core Skill 动作: ${action}`);
    }
    void appendDesktopAuditRecord(PROJECT_ROOTS, {
      action,
      target_kind: 'core_skill_action',
      target_name: action,
      trace_id: traceId,
      outcome: 'succeeded',
      duration_ms: Date.now() - startedAt,
      attributes: { request_id: requestId },
    });
    sendCoreSkillResponse('core_skill_action_response', requestId, 'success', result);
  } catch (error) {
    void appendDesktopAuditRecord(PROJECT_ROOTS, {
      action,
      target_kind: 'core_skill_action',
      target_name: action,
      trace_id: traceId,
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
      diagnostic_hint: action,
      attributes: { request_id: requestId },
    });
    sendCoreSkillResponse(
      'core_skill_action_response',
      requestId,
      'error',
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleCoreSkillConfirmationRequest(frame: Record<string, unknown>): Promise<void> {
  const requestId = typeof frame.request_id === 'string' ? frame.request_id : '';
  const confirmation = frame.confirmation && typeof frame.confirmation === 'object'
    ? frame.confirmation as Record<string, unknown>
    : {};
  const skillId = typeof confirmation.skill_id === 'string' ? confirmation.skill_id : 'unknown';
  const targetName = typeof confirmation.target_name === 'string' ? confirmation.target_name : 'unknown';
  const riskLevel = typeof confirmation.risk_level === 'string' ? confirmation.risk_level : 'unknown';
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? Array.from(rendererWindows)[0] ?? null;
  const response = await dialog.showMessageBox(focusedWindow ?? undefined, {
    type: riskLevel === 'high' || riskLevel === 'critical' ? 'warning' : 'question',
    buttons: ['允许', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: '确认执行 Skill',
    message: `允许执行 ${skillId} / ${targetName}？`,
    detail: `风险等级：${riskLevel}`,
    noLink: true,
  });
  sendCoreSkillResponse('core_skill_confirmation_response', requestId, 'success', {
    approved: response.response === 0,
  });
}

function sendCoreSkillResponse(
  kind: 'core_skill_action_response' | 'core_skill_confirmation_response',
  requestId: string,
  status: 'success' | 'error',
  result?: unknown,
  message?: string,
): void {
  if (kernelSocket?.readyState !== WebSocket.OPEN || !requestId) return;
  kernelSocket.send(JSON.stringify({
    kind,
    request_id: requestId,
    status,
    result,
    message,
    timestamp: Date.now(),
  }));
}

function buildObservabilityQueryContext(): {
  extensionRuntimeProjections: ExtensionRuntimeProjection[];
  runtimeReadiness: RuntimeReadinessCatalog | null;
} {
  return {
    extensionRuntimeProjections: [...lastExtensionRuntimeProjections],
    runtimeReadiness: lastRuntimeReadiness,
  };
}

function redactObservabilityProjectionForRenderer(
  projection: Awaited<ReturnType<typeof queryObservabilityTrace>>,
): Awaited<ReturnType<typeof queryObservabilityTrace>> {
  return {
    ...projection,
    modelInvocations: projection.modelInvocations.map((record) => ({
      timestamp: record.timestamp,
      invocation_id: record.invocation_id,
      trace_id: record.trace_id,
      purpose: record.purpose,
      capture_category: record.capture_category,
      capture_mode: record.capture_mode,
      owner: record.owner,
      runtime_id: record.runtime_id,
      provider_id: record.provider_id,
      model_id: record.model_id,
      outcome: record.outcome,
      duration_ms: record.duration_ms ?? null,
      prompt_chars: record.prompt_chars ?? null,
      response_chars: record.response_chars ?? null,
      prompt_hash: record.prompt_hash ?? null,
      response_hash: record.response_hash ?? null,
      error_code: record.error_code ?? null,
      error_summary: record.error_summary ?? null,
    })),
  };
}

export function registerIPCHandlers(
  win: BrowserWindow,
  surface: SurfaceId,
  options: RegisterIPCHandlersOptions = {},
): void {
  rendererWindows.add(win);
  rendererSurfaces.set(win, surface);
  desktopIpcRouter.trustWindow(win);
  handlerOptions = { ...handlerOptions, ...options };
  win.on('closed', () => {
    rendererWindows.delete(win);
    rendererSurfaces.delete(win);
  });
  if (handlersRegistered) {
    void connectToKernel();
    return;
  }
  handlersRegistered = true;

  desktopIpcRouter.handle('ui:get-connection-status', async () => ({
    status: currentConnectionStatus,
  }));

  desktopIpcRouter.handle('ui:get-audio-status', async () => lastAudioStatus);
  desktopIpcRouter.handle('ui:get-runtime-readiness', async () => lastRuntimeReadiness);
  desktopIpcRouter.handle('ui:get-memory-preview', async () => readMemoryPreview());
  desktopIpcRouter.handle('ui:get-observability-recent-errors', async () => (
    listRecentObservabilityErrors(PROJECT_ROOTS, buildObservabilityQueryContext())
  ));
  desktopIpcRouter.handle('ui:get-observability-recent-events', async () => (
    listRecentObservabilityEvents(PROJECT_ROOTS)
  ));
  desktopIpcRouter.handle('ui:get-observability-maintenance', async () => (
    getObservabilityMaintenanceStatus(PROJECT_ROOTS)
  ));
  desktopIpcRouter.handle('ui:get-observability-trace', async (_event, traceId: unknown) => {
    if (typeof traceId !== 'string' || !traceId.trim()) {
      throw new Error('trace_id is required');
    }
    const projection = await queryObservabilityTrace(
      PROJECT_ROOTS,
      traceId,
      buildObservabilityQueryContext(),
    );
    return redactObservabilityProjectionForRenderer(projection);
  });
  desktopIpcRouter.handle('ui:export-observability-bundle', async (_event, traceId: unknown) => {
    if (typeof traceId !== 'string' || !traceId.trim()) {
      throw new Error('trace_id is required');
    }
    return exportObservabilityBundle(
      PROJECT_ROOTS,
      traceId,
      buildObservabilityQueryContext(),
    );
  });
  desktopIpcRouter.handle('ui:cleanup-observability', async () => (
    cleanupObservability(PROJECT_ROOTS)
  ));

  desktopIpcRouter.handle('ui:get-control-center-settings', async () => readControlCenterSettings());

  desktopIpcRouter.handle('ui:save-control-center-settings', async (_event, payload: unknown) => {
    await saveControlCenterSettings(payload);
    return {
      status: 'saved',
      message: '配置已写入。部分设置需要重启 Glimmer Cradle 后生效。',
    };
  });

  desktopIpcRouter.handle('ui:get-extensions', async () => readExtensionManagementSnapshot());

  desktopIpcRouter.handle('ui:save-extension-config', async (_event, payload: unknown) => (
    saveExtensionConfig(payload)
  ));

  desktopIpcRouter.handle('ui:prepare-extension-install', async (_event, payload: unknown) => (
    prepareExtensionInstall(payload)
  ));

  desktopIpcRouter.handle('ui:commit-extension-install', async (_event, payload: unknown) => (
    commitExtensionInstall(payload)
  ));

  desktopIpcRouter.handle('ui:cancel-extension-install', async (_event, payload: unknown) => (
    cancelExtensionInstall(payload)
  ));

  desktopIpcRouter.handle('ui:uninstall-extension', async (_event, payload: unknown) => (
    uninstallExtension(payload)
  ));

  desktopIpcRouter.handle('ui:request-extension-lifecycle', async (_event, payload: ExtensionLifecycleRequest) => (
    requestExtensionLifecycle(payload)
  ));

  desktopIpcRouter.handle('ui:execute-extension-command', async (_event, payload: ExtensionCommandRequest) => (
    executeExtensionCommand(payload)
  ));

  desktopIpcRouter.handle('ui:get-skill-catalog', async () => requestSkillCatalog());

  desktopIpcRouter.handle('ui:get-avatar-diagnostics', async () => readAvatarDiagnostics());

  desktopIpcRouter.handle('ui:get-avatar-package-catalog', async () => readAvatarPackageCatalog());

  desktopIpcRouter.handle('ui:get-avatar-appearance', async () => readAvatarAppearance());

  desktopIpcRouter.handle('ui:get-character-presentation-projection', async () => (
    readCharacterPresentationProjection()
  ));

  desktopIpcRouter.handle('ui:set-avatar-appearance', async (_event, payload: unknown) => (
    saveAvatarAppearance(payload)
  ));

  desktopIpcRouter.handle('ui:reset-avatar-placement', async () => {
    const appearance = await readAvatarAppearance();
    sendAvatarPresentation(appearance, true);
  });

  desktopIpcRouter.handle('ui:get-avatar-manual-actions', async () => readAvatarManualActions());

  desktopIpcRouter.handle('ui:get-avatar-action-state', async () => readAvatarActionState());

  desktopIpcRouter.handle('ui:set-avatar-action', async (_event, payload: AvatarActionIntentRequest) => {
    await sendAvatarActionIntent(payload);
  });

  desktopIpcRouter.handle('ui:minimize-window', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  desktopIpcRouter.handle('ui:toggle-maximize-window', async (event) => {
    const current = BrowserWindow.fromWebContents(event.sender);
    if (!current) return;
    if (current.isMaximized()) {
      current.unmaximize();
    } else {
      current.maximize();
    }
  });

  desktopIpcRouter.handle('ui:close-window', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  desktopIpcRouter.handle('ui:open-diagnostic-location', async (_event, key: unknown) => {
    if (typeof key !== 'string') return;
    const target = DIAGNOSTIC_LOCATIONS[key];
    if (!target) return;
    await shell.openPath(target);
  });

  desktopIpcRouter.handle('ui:send-perception', async (_event, payload: unknown) => {
    const content = (payload as { content?: string })?.content ?? '';

    if (kernelSocket?.readyState === WebSocket.OPEN) {
      kernelSocket.send(JSON.stringify({
        kind: 'chat_input',
        timestamp: Date.now(),
        chat_input: { text: content },
      }));
    } else {
      sendToRenderer('ui:reply', {
        trace_id: '',
        text: 'Kernel 尚未连接，请确认 pnpm dev 已经启动。',
        messages: [
          {
            sequence: 0,
            content_type: 'text',
            text: 'Kernel 尚未连接，请确认 pnpm dev 已经启动。',
          },
        ],
      });
    }
  });

  desktopIpcRouter.handle('ui:send-audio-input', async (_event, payload: AudioInputPayload) => {
    if (kernelSocket?.readyState === WebSocket.OPEN) {
      kernelSocket.send(JSON.stringify({
        kind: 'audio_input',
        trace_id: payload.trace_id || `ui_audio_${Date.now()}`,
        timestamp: Date.now(),
        audio_input: {
          audio_id: payload.audio_id,
          audio_data: payload.audio_data,
          mime_type: payload.mime_type,
          duration_ms: payload.duration_ms,
          sample_rate: payload.sample_rate,
        },
      }));
      return;
    }

    sendToRenderer('ui:audio-transcript', {
      trace_id: payload.trace_id || '',
      audio_id: payload.audio_id,
      status: 'error',
      message: 'Kernel 尚未连接，无法识别语音。',
    });
  });

  void connectToKernel();
}

export function disconnectKernel(): void {
  kernelShutdownRequested = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (kernelSocket) {
    kernelSocket.close();
    kernelSocket = null;
  }
}

export async function requestKernelShutdown(timeoutMs = 10000): Promise<boolean> {
  if (kernelSocket?.readyState !== WebSocket.OPEN) {
    kernelShutdownRequested = true;
    return false;
  }

  kernelShutdownRequested = true;
  const frame: PresentationUpstreamFrame = {
    kind: 'shutdown_request',
    timestamp: Date.now(),
    shutdown_request: {
      requested_by: 'control-surface',
      reason: '用户选择退出 Glimmer Cradle',
    },
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (completed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      kernelDisconnectWaiters.delete(onDisconnected);
      resolve(completed);
    };
    const onDisconnected = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    kernelDisconnectWaiters.add(onDisconnected);

    try {
      kernelSocket?.send(JSON.stringify(frame));
    } catch {
      finish(false);
    }
  });
}
