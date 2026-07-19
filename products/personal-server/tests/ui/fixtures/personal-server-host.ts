import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  ConfigurationProviderSnapshot,
  ConfigurationSnapshot,
  ConfigurationUpdateRequest,
  ConversationHistoryEntry,
  ExtensionInstallCommitRequest,
  ExtensionInstallPrepareRequest,
  ExtensionInstallationProjection,
  ExtensionLifecycleRequest,
  ExtensionRuntimeProjection,
  ExtensionUninstallRequest,
  PresentationDownstreamFrame,
  RuntimeReadinessCatalog,
  RuntimeReadinessOwner,
  RuntimeReadinessSnapshot,
} from '@glimmer-cradle/protocol';
import { PersonalServerApp } from '../../../src/server/bootstrap/personal-server-app';

type SkillCatalogSnapshot = NonNullable<NonNullable<PresentationDownstreamFrame['skill_catalog_response']>['snapshot']>;

export interface PersonalServerUiFixture {
  readonly baseUrl: string;
  disconnectSurfaceClients(): Promise<void>;
  stop(): Promise<void>;
}

export async function startPersonalServerUiFixture(options?: {
  readonly zeroProvider?: boolean;
}): Promise<PersonalServerUiFixture> {
  const root = mkdtempSync(path.join(tmpdir(), 'personal-server-ui-'));
  const dataRoot = path.join(root, 'data');
  const configRoot = path.join(root, 'configs');
  const runRoot = path.join(dataRoot, 'run', 'host');
  const eventLogPath = path.join(dataRoot, 'observability', 'logs', 'events', 'kernel.jsonl');
  const auditLogPath = path.join(dataRoot, 'observability', 'logs', 'audit', 'kernel.jsonl');
  const applicationLogPath = path.join(dataRoot, 'observability', 'logs', 'application', 'kernel.jsonl');
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const repoRoot = path.resolve(packageRoot, '..', '..');
  mkdirSync(runRoot, { recursive: true });
  mkdirSync(path.dirname(eventLogPath), { recursive: true });
  mkdirSync(path.dirname(auditLogPath), { recursive: true });
  mkdirSync(path.dirname(applicationLogPath), { recursive: true });
  writeFileSync(eventLogPath, `${JSON.stringify({
    timestamp: '2026-07-18T18:10:00.000Z',
    level: 'info',
    event_type: 'config.snapshot',
    event_action: 'read',
    owner: 'configuration',
    module: 'config-owner',
    runtime_id: 'kernel',
    trace_id: 'trace-1',
  })}\n`, 'utf8');
  writeFileSync(auditLogPath, `${JSON.stringify({
    timestamp: '2026-07-18T18:10:01.000Z',
    action: 'config.apply',
    target_kind: 'llm_configuration',
    owner: 'configuration',
    module: 'config-owner',
    runtime_id: 'kernel',
    trace_id: 'trace-2',
    outcome: 'succeeded',
    reason: '',
  })}\n`, 'utf8');
  writeFileSync(applicationLogPath, `${JSON.stringify({
    timestamp: '2026-07-18T18:10:02.000Z',
    level: 'info',
    module: 'kernel-runtime',
    owner: 'kernel',
    runtime_id: 'kernel',
    trace_id: 'trace-3',
    message: 'runtime ready',
  })}\n`, 'utf8');

  const state = createFixtureState(Boolean(options?.zeroProvider));
  const kernelSurface = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await waitForWebSocketServer(kernelSurface);
  const kernelAddress = kernelSurface.address();
  if (!kernelAddress || typeof kernelAddress === 'string') {
    throw new Error('kernel surface did not bind');
  }
  writeFileSync(path.join(runRoot, 'endpoints.json'), JSON.stringify({
    generation: 'fixture-1',
    endpoints: [{
      purpose: 'control-surface',
      endpoint: `ws://127.0.0.1:${kernelAddress.port}`,
    }],
  }), 'utf8');

  kernelSurface.on('connection', (socket) => {
    socket.send(JSON.stringify({
      kind: 'runtime_readiness',
      timestamp: Date.now(),
      runtime_readiness: {
        updated_at: Date.now(),
        runtimes: [
          readyRuntime('kernel.ingress', 'kernel', 'ingress', 'HTTP ingress 已就绪', true),
          readyRuntime('cognition', 'cognition', 'core_ready', 'Cognition 已连接', true),
          readyRuntime('extension.host', 'extension', 'capability_plane', 'Extension Host 已连接', false),
        ],
      } satisfies RuntimeReadinessCatalog,
    } satisfies PresentationDownstreamFrame));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      handleFixtureFrame(socket, frame, state);
    });
  });

  const previousDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
  const previousConfigRoot = process.env.GLIMMER_CRADLE_CONFIG_ROOT;
  process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
  process.env.GLIMMER_CRADLE_CONFIG_ROOT = configRoot;
  const app = new PersonalServerApp({
    host: '127.0.0.1',
    port: 0,
    token: 'server-secret',
    productManifestPath: path.join(packageRoot, 'product.json'),
    cwd: repoRoot,
  });
  await app.start();
  const address = ((app as unknown) as { server: { address(): { port: number } | null } }).server.address();
  if (!address) {
    await app.stop();
    throw new Error('personal server did not bind');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async disconnectSurfaceClients() {
      await Promise.all([...kernelSurface.clients].map(async (client) => {
        client.close();
      }));
    },
    async stop() {
      await app.stop();
      await new Promise<void>((resolve) => kernelSurface.close(() => resolve()));
      if (previousDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
      else process.env.GLIMMER_CRADLE_DATA_ROOT = previousDataRoot;
      if (previousConfigRoot === undefined) delete process.env.GLIMMER_CRADLE_CONFIG_ROOT;
      else process.env.GLIMMER_CRADLE_CONFIG_ROOT = previousConfigRoot;
    },
  };
}

interface FixtureState {
  snapshot: ConfigurationSnapshot;
  skillCatalog: SkillCatalogSnapshot;
  history: ConversationHistoryEntry[];
  extensions: {
    projections: Map<string, ExtensionRuntimeProjection>;
    installations: Map<string, ExtensionInstallationProjection>;
    prepared: Map<string, {
      extension: NonNullable<NonNullable<PresentationDownstreamFrame['extension_install_preview']>['extension']>;
      artifact: NonNullable<NonNullable<PresentationDownstreamFrame['extension_install_preview']>['artifact']>;
      trust: NonNullable<NonNullable<PresentationDownstreamFrame['extension_install_preview']>['trust']>;
    }>;
  };
}

function createFixtureState(zeroProvider: boolean): FixtureState {
  const providers: ConfigurationProviderSnapshot[] = zeroProvider
    ? []
    : [{
      key: 'primary',
      api_type: 'openai',
      base_url: 'https://api.example.com',
      has_api_key: true,
      models: [{ alias: 'chat', model_id: 'gpt-4.1' }],
    }];
  return {
    snapshot: {
      revision: 'fixture-rev-1',
      llm: {
        provider_count: providers.length,
        providers,
        default_route: zeroProvider
          ? { ready: false, reason: '尚未配置默认对话模型。' }
          : {
            provider_key: 'primary',
            model_alias: 'chat',
            effective_model_id: 'gpt-4.1',
            ready: true,
          },
      },
      audio: {
        tts: {
          enabled: false,
          route: {
            primary: 'dashscope-cosyvoice',
            fallbacks: [],
            circuit_breaker: {
              failure_threshold: 3,
              recovery_timeout_ms: 30000,
            },
          },
          cache: {
            enabled: true,
            max_age_days: 30,
          },
          providers: {
            'dashscope-cosyvoice': {
              enabled: true,
              endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
              model: 'cosyvoice-v3.5-flash',
              format: 'wav',
              sample_rate: 24000,
              connect_timeout_ms: 5000,
              receive_timeout_ms: 20000,
              max_retries: 1,
            },
          },
        },
        asr: {
          enabled: false,
          provider: 'funasr',
          resource_id: 'funasr.sensevoice-small',
        },
      },
      embedding: {
        enabled: false,
        route: {
          provider: 'dashscope-text-embedding',
        },
        providers: {
          'dashscope-text-embedding': {
            endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
            model: 'text-embedding-v4',
            dimensions: 1024,
            request_timeout_ms: 15000,
            max_retries: 1,
          },
          'local-sentence-transformers': {
            model_path: 'embedding/m3e-small',
            model_id: 'moka-ai/m3e-small',
            auto_download: false,
            device: 'cpu',
            batch_size: 64,
          },
        },
      },
      memory: {
        working: {
          max_messages_per_conversation: 32,
          hydrate_recent_messages: 32,
          context_message_limit: 8,
        },
        conversation: {
          segment_target_messages: 20,
          chapter_idle_minutes: 360,
          chapter_segment_limit: 8,
          state_update_messages: 6,
          history_candidate_limit: 12,
          history_result_limit: 4,
          summary_max_chars: 2400,
        },
        experience: {
          enabled: true,
          pack_max_size_mb: 256,
          flush_interval_ms: 500,
          flush_max_buffer: 64,
          episode_idle_seconds: 300,
          seal_integrity_check: true,
        },
        consolidation: {
          enabled: true,
          batch_size: 8,
          max_batch_moments: 64,
          debounce_seconds: 120,
          max_wait_seconds: 900,
          lease_seconds: 180,
          retry_base_seconds: 30,
          minimum_salience: 0.45,
          autobiographical_evidence_threshold: 3,
          schedule_interval_seconds: 300,
        },
        retrieval: {
          token_budget: 800,
          candidate_limit: 24,
          result_limit: 6,
          semantic_weight: 0.35,
        },
      },
      skills: {
        mcp_servers: [],
        user_skills: {
          enabled: false,
          root_dir: 'skills',
        },
      },
      storage: {
        config_root: '/fixture/configs',
        data_root: '/fixture/data',
        state_root: '/fixture/data/state',
      },
      service: {
        cognition_ready: true,
        restart_supported: true,
      },
    },
    skillCatalog: {
      generatedAt: '2026-07-18T18:06:00.000Z',
      totalSkills: 3,
      providerCounts: {
        core: 1,
        extension: 1,
        mcp_server: 0,
        user: 1,
      },
      runtimeStatusCounts: {
        ready: 2,
        contract_only: 1,
      },
      totalTools: 4,
      totalResources: 1,
      totalPrompts: 0,
      providerRuntimes: [
        {
          provider: { kind: 'core', id: 'kernel' },
          display_name: 'Kernel Core Skills',
          state: 'ready',
          summary: '内建 Skill Plane 已就绪。',
          skill_count: 1,
          tool_count: 2,
          resource_count: 0,
          prompt_count: 0,
          recovery_actions: [],
          metadata: {},
          updated_at: '2026-07-18T18:06:00.000Z',
        },
        {
          provider: { kind: 'extension', id: 'community.echo' },
          display_name: 'Community Echo',
          state: 'contract_only',
          summary: '扩展已安装但尚未运行，私有 Skill 仅保留契约。',
          skill_count: 1,
          tool_count: 1,
          resource_count: 1,
          prompt_count: 0,
          recovery_actions: ['启用扩展', '检查外部适配器连接'],
          metadata: {
            extension_id: 'community.echo',
            compatibility: {
              product: 'personal-server',
              platform: 'linux',
            },
          },
          updated_at: '2026-07-18T18:06:00.000Z',
        },
        {
          provider: { kind: 'user', id: 'user-skills' },
          display_name: 'User Skills',
          state: 'stopped',
          summary: '用户技能目录当前未启用。',
          skill_count: 1,
          tool_count: 1,
          resource_count: 0,
          prompt_count: 0,
          recovery_actions: ['在设置中启用 User Skills'],
          metadata: {},
          updated_at: '2026-07-18T18:06:00.000Z',
        },
      ],
      entries: [
        {
          id: 'core.system.status',
          name: '系统状态',
          description: '读取当前服务状态与受管资源摘要。',
          audience: 'user',
          scope: { kind: 'global' },
          provider: { kind: 'core', id: 'kernel' },
          tools: [{
            name: 'status.read',
            description: '读取状态摘要',
            audience: 'user',
            scope: { kind: 'global' },
          }],
          resources: [],
          prompts: [],
          policy: {
            riskLevel: 'low',
            confirmationRequired: false,
            sideEffects: [],
            audit: true,
          },
          metadata: {
            runtime_status: 'ready',
            owner: 'kernel',
          },
        },
        {
          id: 'extension.community.echo.reply',
          name: 'Echo Reply',
          description: '扩展私有回复 Skill，只在该扩展贡献的会话上下文可见。',
          audience: 'extension',
          scope: { kind: 'source_provider', ids: ['community.echo'] },
          provider: { kind: 'extension', id: 'community.echo' },
          tools: [{
            name: 'echo.reply',
            description: '生成 Echo 扩展回复',
            audience: 'extension',
            scope: { kind: 'source_provider', ids: ['community.echo'] },
          }],
          resources: [{
            id: 'echo.config',
            description: '扩展私有配置资源',
            audience: 'extension',
            scope: { kind: 'source_provider', ids: ['community.echo'] },
          }],
          prompts: [],
          policy: {
            riskLevel: 'medium',
            confirmationRequired: false,
            sideEffects: ['读取扩展上下文'],
            audit: true,
          },
          metadata: {
            runtime_status: 'contract_only',
            visibility: 'extension_private',
            readiness_reason: 'extension_stopped',
          },
        },
        {
          id: 'user.local.maintenance',
          name: 'Local Maintenance',
          description: '用户目录中的维护 Skill，当前未启用。',
          audience: 'user',
          scope: { kind: 'global' },
          provider: { kind: 'user', id: 'user-skills' },
          tools: [{
            name: 'maintenance.preview',
            description: '预览维护动作',
            audience: 'user',
            scope: { kind: 'global' },
          }],
          resources: [],
          prompts: [],
          policy: {
            riskLevel: 'medium',
            confirmationRequired: true,
            sideEffects: ['可能触发运维动作'],
            audit: true,
          },
          metadata: {
            runtime_status: 'contract_only',
            readiness_reason: 'user_skills_disabled',
          },
        },
      ],
    },
    history: [{
      entry_id: 'history-entry-1',
      source_kind: 'conversation',
      role: 'assistant',
      status: 'committed',
      text: '这是从服务端恢复的历史。',
      occurred_at: '2026-07-18T18:00:00.000Z',
      position: 1,
      conversation_id: 'conversation:desktop',
      scene_id: 'scene:desktop',
      thread_id: 'main',
      recall_scope: 'conversation_private',
      disclosure_scope: 'conversation_private',
    }],
    extensions: {
      projections: new Map([
        ['community.echo', createExtensionProjection({
          extension_id: 'community.echo',
          display_name: 'Community Echo',
          version: '1.0.0',
          lifecycle: 'stopped',
          summary: '已安装，等待启用。',
        })],
      ]),
      installations: new Map([
        ['community.echo', {
          extension_id: 'community.echo',
          installed_versions: ['1.0.0'],
          active_version: '1.0.0',
          updated_at: '2026-07-18T18:05:00.000Z',
        }],
      ]),
      prepared: new Map(),
    },
  };
}

function handleFixtureFrame(socket: WebSocket, frame: Record<string, unknown>, state: FixtureState): void {
  switch (frame.kind) {
    case 'conversation_history_request': {
      const request = frame.conversation_history_request as { request_id?: string; cursor?: string } | undefined;
      socket.send(JSON.stringify({
        kind: 'conversation_history_result',
        timestamp: Date.now(),
        conversation_history_result: {
          request_id: request?.request_id || `history-${Date.now()}`,
          status: 'success',
          conversation: {
            source_provider_id: 'desktop-ui',
            scene_id: 'scene:desktop',
            conversation_id: 'conversation:desktop',
            thread_id: 'main',
            recall_scope: 'conversation_private',
            disclosure_scope: 'conversation_private',
          },
          items: request?.cursor ? [] : state.history,
          has_more: false,
        },
      }));
      return;
    }
    case 'config_snapshot_request': {
      const request = frame.config_snapshot_request as { request_id?: string } | undefined;
      socket.send(JSON.stringify({
        kind: 'configuration_snapshot_result',
        timestamp: Date.now(),
        configuration_snapshot_result: {
          request_id: request?.request_id || `snapshot-${Date.now()}`,
          status: 'success',
          snapshot: state.snapshot,
        },
      }));
      return;
    }
    case 'config_test_request': {
      const request = frame.config_test_request as { request_id?: string } | undefined;
      socket.send(JSON.stringify({
        kind: 'configuration_test_result',
        timestamp: Date.now(),
        configuration_test_result: {
          request_id: request?.request_id || `test-${Date.now()}`,
          status: 'success',
          message: '连接成功，发现 2 个模型。',
          discovered_models: ['gpt-4.1', 'gpt-4o-mini'],
          latency_ms: 42,
        },
      }));
      return;
    }
    case 'config_update_request': {
      const request = frame.config_update_request as ConfigurationUpdateRequest;
      state.snapshot = applyUpdate(state.snapshot, request);
      state.skillCatalog = applySkillCatalogUpdate(state.skillCatalog, request);
      socket.send(JSON.stringify({
        kind: 'configuration_update_result',
        timestamp: Date.now(),
        configuration_update_result: {
          request_id: request.request_id,
          status: request.dry_run ? 'preview' : 'success',
          apply_state: request.dry_run ? 'unchanged' : 'completed',
          change_summary: ['更新 Provider 配置', '切换默认路由到 primary/chat'],
          new_revision: state.snapshot.revision,
          snapshot: state.snapshot,
          message: request.dry_run ? '已生成预览。' : '配置已保存。',
        },
      }));
      return;
    }
    case 'skill_catalog_request': {
      const request = frame.skill_catalog_request as { request_id?: string } | undefined;
      socket.send(JSON.stringify({
        kind: 'skill_catalog_response',
        timestamp: Date.now(),
        skill_catalog_response: {
          request_id: request?.request_id || `skill-catalog-${Date.now()}`,
          status: 'success',
          snapshot: state.skillCatalog,
        },
      }));
      return;
    }
    case 'extension_runtime_projection_request': {
      const request = frame.extension_runtime_projection_request as { request_id?: string; extension_id?: string } | undefined;
      const extensionId = request?.extension_id?.trim() || '';
      const projections = extensionId
        ? [state.extensions.projections.get(extensionId)].filter(Boolean)
        : [...state.extensions.projections.values()];
      const installations = extensionId
        ? [state.extensions.installations.get(extensionId)].filter(Boolean)
        : [...state.extensions.installations.values()];
      socket.send(JSON.stringify({
        kind: 'extension_runtime_projection_result',
        timestamp: Date.now(),
        extension_runtime_projection_result: {
          request_id: request?.request_id || `extension-runtime-${Date.now()}`,
          status: 'success',
          projections,
          installations,
        },
      }));
      return;
    }
    case 'extension_install_prepare': {
      const request = frame.extension_install_prepare as ExtensionInstallPrepareRequest;
      const preview = buildExtensionPreview(request);
      if (preview.status === 'ready' && preview.transaction_id && preview.extension && preview.artifact && preview.trust) {
        state.extensions.prepared.set(preview.transaction_id, {
          extension: preview.extension,
          artifact: preview.artifact,
          trust: preview.trust,
        });
      }
      socket.send(JSON.stringify({
        kind: 'extension_install_preview',
        timestamp: Date.now(),
        extension_install_preview: preview,
      }));
      return;
    }
    case 'extension_install_commit': {
      const request = frame.extension_install_commit as ExtensionInstallCommitRequest;
      const prepared = state.extensions.prepared.get(request.transaction_id);
      if (!prepared) {
        socket.send(JSON.stringify({
          kind: 'extension_install_result',
          timestamp: Date.now(),
          extension_install_result: {
            request_id: request.request_id,
            status: 'error',
            message: '安装事务不存在或已过期。',
          },
        }));
        return;
      }
      state.extensions.prepared.delete(request.transaction_id);
      const existingInstallation = state.extensions.installations.get(prepared.extension.id);
      const nextVersions = sortInstalledVersions([
        ...(existingInstallation?.installed_versions ?? []),
        prepared.extension.version,
      ]);
      state.extensions.installations.set(prepared.extension.id, {
        extension_id: prepared.extension.id,
        installed_versions: nextVersions,
        active_version: existingInstallation?.active_version,
        updated_at: new Date().toISOString(),
      });
      const existingProjection = state.extensions.projections.get(prepared.extension.id);
      state.extensions.projections.set(prepared.extension.id, existingProjection
        ? {
            ...existingProjection,
            display_name: prepared.extension.name,
            permissions: prepared.extension.permissions,
            summary: '扩展新版本已安装，可直接升级或回滚切换。',
            updated_at: new Date().toISOString(),
          }
        : createExtensionProjection({
            extension_id: prepared.extension.id,
            display_name: prepared.extension.name,
            version: prepared.extension.version,
            lifecycle: 'stopped',
            summary: '扩展已安装，等待启用。',
            permissions: prepared.extension.permissions,
          }));
      socket.send(JSON.stringify({
        kind: 'extension_install_result',
        timestamp: Date.now(),
        extension_install_result: {
          request_id: request.request_id,
          status: 'success',
          extension_id: prepared.extension.id,
          version: prepared.extension.version,
          already_installed: false,
        },
      }));
      return;
    }
    case 'extension_install_cancel': {
      const request = frame.extension_install_cancel as { request_id?: string; transaction_id?: string } | undefined;
      if (request?.transaction_id) state.extensions.prepared.delete(request.transaction_id);
      socket.send(JSON.stringify({
        kind: 'extension_install_result',
        timestamp: Date.now(),
        extension_install_result: {
          request_id: request?.request_id || `extension-cancel-${Date.now()}`,
          status: 'cancelled',
        },
      }));
      return;
    }
    case 'extension_lifecycle_request': {
      const request = frame.extension_lifecycle_request as ExtensionLifecycleRequest;
      const projection = state.extensions.projections.get(request.extension_id);
      const installation = state.extensions.installations.get(request.extension_id);
      if (!projection || !installation) {
        socket.send(JSON.stringify({
          kind: 'extension_lifecycle_result',
          timestamp: Date.now(),
          extension_lifecycle_result: {
            request_id: request.request_id,
            extension_id: request.extension_id,
            version: request.version,
            operation: request.operation,
            status: 'error',
            message: '扩展不存在。',
          },
        }));
        return;
      }
      if (request.operation === 'start') {
        const selectedVersion = request.version || installation.active_version || installation.installed_versions[0];
        if (!selectedVersion || !installation.installed_versions.includes(selectedVersion)) {
          socket.send(JSON.stringify({
            kind: 'extension_lifecycle_result',
            timestamp: Date.now(),
            extension_lifecycle_result: {
              request_id: request.request_id,
              extension_id: request.extension_id,
              version: request.version,
              operation: request.operation,
              status: 'error',
              message: '请求的扩展版本不存在。',
            },
          }));
          return;
        }
        installation.active_version = selectedVersion;
        projection.version = selectedVersion;
        projection.lifecycle = 'running';
        projection.summary = `扩展正在运行，当前激活 ${selectedVersion}。`;
      } else {
        installation.active_version = undefined;
        projection.lifecycle = 'stopped';
        projection.summary = '扩展已停止。';
      }
      projection.updated_at = new Date().toISOString();
      installation.updated_at = new Date().toISOString();
      socket.send(JSON.stringify({
        kind: 'extension_lifecycle_result',
        timestamp: Date.now(),
        extension_lifecycle_result: {
          request_id: request.request_id,
          extension_id: request.extension_id,
          version: installation.active_version || request.version,
          operation: request.operation,
          status: 'success',
        },
      }));
      socket.send(JSON.stringify({
        kind: 'extension_runtime_projection_changed',
        timestamp: Date.now(),
        extension_runtime_projection_changed: projection,
      }));
      return;
    }
    case 'extension_uninstall_request': {
      const request = frame.extension_uninstall_request as ExtensionUninstallRequest;
      const installation = state.extensions.installations.get(request.extension_id);
      if (installation?.active_version === request.version) {
        socket.send(JSON.stringify({
          kind: 'extension_uninstall_result',
          timestamp: Date.now(),
          extension_uninstall_result: {
            request_id: request.request_id,
            extension_id: request.extension_id,
            version: request.version,
            status: 'error',
            message: '当前激活版本不能直接卸载，请先切换到其他版本或停用扩展。',
          },
        }));
        return;
      }
      if (installation) {
        const remainingVersions = installation.installed_versions.filter((version) => version !== request.version);
        if (remainingVersions.length > 0) {
          installation.installed_versions = remainingVersions as [string, ...string[]];
          installation.updated_at = new Date().toISOString();
        } else {
          state.extensions.installations.delete(request.extension_id);
          state.extensions.projections.delete(request.extension_id);
        }
      }
      socket.send(JSON.stringify({
        kind: 'extension_uninstall_result',
        timestamp: Date.now(),
        extension_uninstall_result: {
          request_id: request.request_id,
          extension_id: request.extension_id,
          version: request.version,
          status: 'success',
        },
      }));
      return;
    }
    case 'chat_input': {
      const traceId = typeof frame.trace_id === 'string' ? frame.trace_id : `chat-${Date.now()}`;
      const submittedText = String((frame.chat_input as { text?: string } | undefined)?.text || '');
      if (!state.snapshot.llm.default_route.ready) {
        state.history = [
          ...state.history,
          createHistoryEntry(state.history.length + 1, {
            entry_id: `history-user-${traceId}`,
            role: 'user',
            status: 'failed',
            text: submittedText,
            trace_id: traceId,
          }),
          createHistoryEntry(state.history.length + 2, {
            entry_id: `history-notice-${traceId}`,
            role: 'system',
            source_kind: 'notice',
            status: 'notice',
            title: '尚未配置可用模型',
            text: '控制面可以正常使用，但当前默认对话路由没有可用模型。',
            trace_id: traceId,
          }),
        ];
        socket.send(JSON.stringify({
          kind: 'conversation_notice',
          trace_id: traceId,
          timestamp: Date.now(),
          conversation_notice: {
            code: 'llm_unconfigured',
            level: 'warning',
            title: '尚未配置可用模型',
            message: '控制面可以正常使用，但当前默认对话路由没有可用模型。',
            action_route: 'settings',
            action_label: '打开设置中心',
          },
        }));
        return;
      }
      socket.send(JSON.stringify({
        kind: 'thought',
        trace_id: traceId,
        timestamp: Date.now(),
        thought: { active: true, hint: '正在思考…' },
      }));
      socket.send(JSON.stringify({
        kind: 'reply',
        trace_id: traceId,
        timestamp: Date.now(),
        reply: { text: '这是测试回复。', messages: [{ content_type: 'text', text: '这是测试回复。' }] },
      }));
      state.history = [
        ...state.history,
        createHistoryEntry(state.history.length + 1, {
          entry_id: `history-user-${traceId}`,
          role: 'user',
          status: 'committed',
          text: submittedText,
          trace_id: traceId,
        }),
        createHistoryEntry(state.history.length + 2, {
          entry_id: `history-assistant-${traceId}`,
          role: 'assistant',
          status: 'committed',
          text: '这是测试回复。',
          trace_id: traceId,
        }),
      ];
    }
  }
}

function applyUpdate(snapshot: ConfigurationSnapshot, request: ConfigurationUpdateRequest): ConfigurationSnapshot {
  const providers = request.llm.providers.map((provider) => ({
    key: provider.key,
    api_type: provider.api_type,
    base_url: provider.base_url,
    has_api_key: Boolean(provider.api_key?.trim()) || snapshot.llm.providers.find((item) => item.key === provider.key)?.has_api_key || false,
    temperature: provider.temperature,
    request_method: provider.request_method,
    request_path: provider.request_path,
    response_extract: provider.response_extract,
    models: provider.models,
  }));
  const selectedProvider = providers.find((provider) => provider.key === request.llm.default_route_provider_key);
  const selectedModel = selectedProvider?.models.find((model) => model.alias === request.llm.default_route_model_alias);
  return {
    ...snapshot,
    revision: `fixture-rev-${Date.now()}`,
    audio: request.audio,
    embedding: request.embedding,
    memory: request.memory,
    skills: request.skills,
    llm: {
      provider_count: providers.length,
      providers,
      default_route: selectedProvider && selectedModel
        ? {
          provider_key: selectedProvider.key,
          model_alias: selectedModel.alias,
          effective_model_id: selectedModel.model_id,
          ready: selectedProvider.has_api_key,
          reason: selectedProvider.has_api_key ? undefined : '默认路由 Provider 尚未配置 API Key。',
        }
        : { ready: false, reason: '尚未配置默认对话模型。' },
    },
  };
}

function applySkillCatalogUpdate(
  snapshot: SkillCatalogSnapshot,
  request: ConfigurationUpdateRequest,
): SkillCatalogSnapshot {
  const userSkillsEnabled = Boolean(request.skills.user_skills?.enabled);
  const nextRuntimes = snapshot.providerRuntimes.map((runtime) => {
    if (runtime.provider.kind !== 'user' || runtime.provider.id !== 'user-skills') {
      return runtime;
    }
    const state: SkillCatalogSnapshot['providerRuntimes'][number]['state'] = userSkillsEnabled ? 'ready' : 'stopped';
    return {
      ...runtime,
      state,
      summary: userSkillsEnabled
        ? '用户技能目录已启用，等待索引与运行时接入。'
        : '用户技能目录当前未启用。',
      updated_at: new Date().toISOString(),
    };
  });
  const nextEntries = snapshot.entries.map((entry) => {
    if (entry.provider.kind !== 'user' || entry.provider.id !== 'user-skills') {
      return entry;
    }
    return {
      ...entry,
      metadata: {
        ...entry.metadata,
        runtime_status: userSkillsEnabled ? 'ready' : 'contract_only',
        readiness_reason: userSkillsEnabled ? undefined : 'user_skills_disabled',
      },
    };
  });
  return {
    ...snapshot,
    generatedAt: new Date().toISOString(),
    runtimeStatusCounts: nextEntries.reduce(
      (counts, entry) => {
        const status = entry.metadata?.runtime_status === 'contract_only' ? 'contract_only' : 'ready';
        counts[status] += 1;
        return counts;
      },
      { ready: 0, contract_only: 0 },
    ),
    providerRuntimes: nextRuntimes,
    entries: nextEntries,
  };
}

function readyRuntime(
  runtime_id: string,
  owner: RuntimeReadinessOwner,
  phase: string,
  summary: string,
  blocking: boolean,
): RuntimeReadinessSnapshot {
  return {
    runtime_id,
    owner,
    phase,
    state: 'ready',
    summary,
    blocking,
  };
}

function createHistoryEntry(
  position: number,
  entry: {
    readonly entry_id: string;
    readonly role: ConversationHistoryEntry['role'];
    readonly status: ConversationHistoryEntry['status'];
    readonly text: string;
    readonly trace_id?: string;
    readonly title?: string;
    readonly source_kind?: ConversationHistoryEntry['source_kind'];
  },
): ConversationHistoryEntry {
  return {
    entry_id: entry.entry_id,
    source_kind: entry.source_kind ?? 'conversation',
    role: entry.role,
    status: entry.status,
    text: entry.text,
    title: entry.title,
    occurred_at: new Date().toISOString(),
    position,
    trace_id: entry.trace_id,
    conversation_id: 'conversation:desktop',
    scene_id: 'scene:desktop',
    thread_id: 'main',
    recall_scope: 'conversation_private',
    disclosure_scope: 'conversation_private',
  };
}

function createExtensionProjection(entry: {
  readonly extension_id: string;
  readonly display_name: string;
  readonly version: string;
  readonly lifecycle: ExtensionRuntimeProjection['lifecycle'];
  readonly summary: string;
  readonly permissions?: string[];
}): ExtensionRuntimeProjection {
  return {
    schema: 'glimmer-cradle.extension.runtime-projection',
    extension_id: entry.extension_id,
    display_name: entry.display_name,
    version: entry.version,
    description: `${entry.display_name} fixture projection`,
    permissions: entry.permissions ?? ['CONFIG_READ_SELF'],
    tags: ['fixture'],
    lifecycle: entry.lifecycle,
    summary: entry.summary,
    contribution_points: [],
    capability_graph: { nodes: [], edges: [] },
    actions: [],
    diagnostics: {
      summary: '当前没有诊断。',
      entries: [],
      log_locations: [],
      recovery_actions: [],
    },
    updated_at: new Date().toISOString(),
  };
}

function buildExtensionPreview(request: ExtensionInstallPrepareRequest): NonNullable<PresentationDownstreamFrame['extension_install_preview']> {
  const requestId = request.request_id || `extension-preview-${Date.now()}`;
  const sourceLabel = request.source.kind === 'repository'
    ? request.source.repository.split('/').pop() || 'repository-extension'
    : request.source.kind === 'registry'
      ? request.source.extension_id
      : request.source.kind === 'file'
        ? normalizeUploadedPackageName(path.basename(request.source.path, '.gcex')) || 'local-extension'
      : request.source.kind === 'uploaded_package'
        ? normalizeUploadedPackageName(request.source.upload_id) || 'local-extension'
        : 'release-manifest-extension';
  const version = request.source.kind === 'repository'
    ? request.source.tag.replace(/^v/i, '') || '1.0.0'
    : '1.0.0';
  const extensionId = request.source.kind === 'repository'
    ? request.source.repository.trim().replace(/^https?:\/\//i, '').split('/').slice(-2).join('.').toLowerCase()
    : request.source.kind === 'registry'
      ? request.source.extension_id
      : `community.${sourceLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return {
    request_id: requestId,
    status: 'ready',
    transaction_id: `tx-${Date.now()}`,
    extension: {
      id: extensionId,
      name: sourceLabel,
      version,
      publisher: 'fixture-publisher',
      description: 'Fixture extension preview',
      permissions: ['CONFIG_READ_SELF'],
      platforms: ['personal-server'],
    },
    artifact: {
      sha256: 'fixture-sha256',
      size: 1024,
      platform: 'personal-server',
    },
    trust: {
      source_kind: request.source.kind === 'uploaded_package' || request.source.kind === 'file'
        ? 'file'
        : request.source.kind,
      listing_reviewed: request.source.kind === 'registry',
      publisher_verified: true,
      artifact_signed: true,
      build_attested: request.source.kind !== 'release_manifest',
      registry_id: request.source.kind === 'registry' ? 'fixture-registry' : undefined,
      repository: request.source.kind === 'repository' ? request.source.repository : undefined,
    },
  };
}

function normalizeUploadedPackageName(value: string): string {
  return value
    .replace(/^\d+-[0-9a-f-]+-/i, '')
    .replace(/^upload_[0-9a-f-]+-/i, '');
}

function sortInstalledVersions(versions: string[]): [string, ...string[]] {
  const unique = [...new Set(versions)];
  unique.sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));
  return unique as [string, ...string[]];
}

function waitForWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}
