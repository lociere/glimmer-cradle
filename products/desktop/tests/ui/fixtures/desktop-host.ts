import type { Page } from '@playwright/test';

const settingsSnapshot = {
  inference: { maxTokens: 1024, temperature: 0.7, topP: 0.9 },
  lifeClock: {
    heartbeatEnabled: false,
    heartbeatIntervalMs: 45_000,
    focusDurationMs: 300_000,
    ingressDebounceMs: 800,
    focusOnAnyChat: true,
    summonKeywords: ['月见', 'Selrena'],
  },
  embedding: {
    enabled: true,
    autoDownload: true,
    device: 'cuda:0',
    modelPath: 'data/models/embedding',
    modelId: 'BAAI/bge-small-zh-v1.5',
  },
  modelServices: {
    activeProviderId: 'test-provider',
    providers: [{
      id: 'test-provider',
      apiType: 'openai',
      baseUrl: 'https://example.invalid/v1',
      temperature: 0.7,
      models: { chat: 'selrena-test-model', reasoner: '', vision: '', audio: '' },
    }],
  },
  persona: { nickname: '月见', personaMode: 'api' },
  surfaces: {},
  avatar: { enabled: true },
  audio: { ttsEnabled: true, asrEnabled: true, cloudVoiceId: 'selrena-test' },
};

/** 浏览器测试只投影 renderer 所需契约，不启动 Kernel、模型或原生窗口。 */
export async function installDesktopHostMock(page: Page): Promise<void> {
  await page.addInitScript((initialSettings) => {
    let settings = structuredClone(initialSettings);
    let appearance = { modelId: 'youling', displayScale: 1.2, placementId: 'bust' };
    const characterPresentationProjection = {
      avatar_package_id: 'selrena-youling',
      model_id: 'youling',
      display_name: '月见 Live2D（幽灵）',
      kind: 'live2d',
      backend: 'unity',
      host_kind: 'unity',
      avatar_state: 'ready',
      appearance: {
        placement_id: 'bust',
        display_scale: 1.2,
      },
      lifecycle: {
        worker_window_state: 'isolated',
        composition_surface_state: 'attached',
        first_frame_presented: true,
        interaction_ready: true,
        ready: true,
        summary: 'Avatar Package / composition surface / first frame / interaction ready',
      },
    };
    const runtimeReadinessCatalog = {
      generated_at: new Date().toISOString(),
      runtimes: [
        {
          runtime_id: 'desktop.ui',
          owner: 'renderer',
          phase: 'surface',
          state: 'ready',
          blocking: false,
          summary: '桌面窗口已就绪',
        },
        {
          runtime_id: 'avatar.host',
          owner: 'renderer',
          phase: 'host_ready',
          state: 'ready',
          blocking: false,
          summary: 'Avatar 已完成首帧和交互准备',
          reconciler: {
            desired: 'avatar-ready',
            actual: 'connected-first-frame-presented',
            readiness: 'ready',
            resources: [
              {
                resource_id: 'avatar.package-registry',
                resource_kind: 'avatar_package_registry',
                desired_state: 'ready',
                actual_state: 'ready',
                readiness: 'ready',
                summary: 'Avatar Package Registry 投影已就绪',
                recovery_actions: [],
              },
              {
                resource_id: 'avatar.host.executable',
                resource_kind: 'host_executable',
                desired_state: 'ready',
                actual_state: 'ready',
                readiness: 'ready',
                summary: 'Avatar 构建产物已就绪',
                recovery_actions: [],
              },
              {
                resource_id: 'avatar.sdk.cubism-unity',
                resource_kind: 'unity_sdk',
                desired_state: 'ready',
                actual_state: 'ready',
                readiness: 'ready',
                summary: 'Live2D Cubism SDK 已导入 Unity 项目',
                recovery_actions: [],
              },
            ],
          },
        },
        {
          runtime_id: 'extension.host',
          owner: 'extension',
          phase: 'capability_plane',
          state: 'ready',
          blocking: false,
          summary: '扩展宿主已就绪',
          reconciler: {
            desired: 'extensions-ready',
            actual: 'extensions-ready',
            readiness: 'ready',
            resources: [
              {
                resource_id: 'extension.workspace-bridge',
                resource_kind: 'extension_runtime',
                desired_state: 'ready',
                actual_state: 'ready',
                readiness: 'ready',
                summary: 'Workspace Bridge 已就绪',
                recovery_actions: [],
              },
            ],
          },
        },
      ],
    };
    const avatarPackageCatalog = {
      schema: 'glimmer.avatar.body-catalog.v1',
      defaultAvatarPackageId: 'selrena-youling',
      defaultModelId: 'youling',
      packages: [
        {
          id: 'selrena-youling',
          characterId: 'selrena',
          modelId: 'youling',
          displayName: '月见 Live2D（幽灵）',
          kind: 'live2d',
          preferredBackend: 'unity',
          live2dVersion: 'cubism4',
          assetRootPath: 'assets/avatar/youling',
          modelPath: 'assets/avatar/youling/youling.model3.json',
          previewImagePath: 'assets/avatar/selrena/standee/selrena-standee-v25.png',
          actionsPath: 'assets/avatar/youling/avatar-actions.json',
          behaviorPath: 'assets/avatar/youling/avatar-behavior.json',
          presentation: {
            defaultPlacement: 'bust',
            placementPresets: {
              bust: { visibleRatio: 0.4, rightInset: 24, bottomInset: 0 },
              'three-quarter': { visibleRatio: 0.76, rightInset: 24, bottomInset: 0 },
              'full-body': { visibleRatio: 1, rightInset: 24, bottomInset: 16 },
            },
          },
        },
      ],
    };
    const readAvatarActionState = (): { activeActionIds: string[] } => {
      try {
        const stored = window.localStorage.getItem('gc-test-avatar-action-state');
        const parsed = stored ? JSON.parse(stored) as { activeActionIds?: unknown } : null;
        return {
          activeActionIds: Array.isArray(parsed?.activeActionIds)
            ? parsed.activeActionIds.filter((item): item is string => typeof item === 'string')
            : [],
        };
      } catch {
        return { activeActionIds: [] };
      }
    };
    const writeAvatarActionState = (state: { activeActionIds: string[] }): void => {
      window.localStorage.setItem('gc-test-avatar-action-state', JSON.stringify(state));
    };
    let avatarActionState = readAvatarActionState();
    let avatarActionStateListener: ((state: typeof avatarActionState) => void) | null = null;
    type TestExtensionEvent = 'started' | 'stopped' | 'error';
    type TestExtensionOperationalState = 'disabled' | 'stopped' | 'ready' | 'degraded' | 'error';
    let extensionsSnapshot = {
      extensionRoot: 'managed-extension-catalog',
      activeConfigPath: 'managed-extension-list',
      extensions: [
        {
          id: 'workspace-bridge',
          name: 'Workspace Bridge',
          description: '连接外部工作台并提供受控同步能力。',
          version: '0.1.0',
          enabled: true,
          running: true,
          operationalState: 'ready' as TestExtensionOperationalState,
          operationalSummary: '扩展宿主和声明依赖均已就绪。',
          configYaml: 'enabled: true\nsync:\n  mode: curated\n  intervalMinutes: 15\n',
          configPath: 'managed-config:workspace-bridge',
          permissions: ['network.client', 'desktop.confirmation'],
          tags: ['workspace', 'sync'],
          commands: [
            { command: 'workspace-bridge.getStatus', title: '读取状态', category: '同步', state: 'enabled' as const },
            { command: 'workspace-bridge.openDashboard', title: '打开面板', category: '桌面', state: 'enabled' as const },
            { command: 'workspace-bridge.refreshCatalog', title: '刷新目录', category: '同步', state: 'enabled' as const },
            { command: 'workspace-bridge.pauseSync', title: '暂停同步', category: '同步', state: 'enabled' as const },
          ],
          contributions: {
            commands: [
              { command: 'workspace-bridge.getStatus', title: '读取状态', category: '同步', state: 'enabled' as const },
              { command: 'workspace-bridge.openDashboard', title: '打开面板', category: '桌面', state: 'enabled' as const },
              { command: 'workspace-bridge.refreshCatalog', title: '刷新目录', category: '同步', state: 'enabled' as const },
              { command: 'workspace-bridge.pauseSync', title: '暂停同步', category: '同步', state: 'enabled' as const },
            ],
            settings: [
              {
                key: 'sync.intervalMinutes',
                title: '同步间隔',
                description: '自动同步之间的等待时间。',
                type: 'number',
              },
            ],
            skills: [
              {
                id: 'workspace-sync',
                name: '工作台同步',
                description: '读取外部工作台摘要并提交受控同步。',
                toolCount: 1,
                resourceCount: 0,
                promptCount: 0,
                riskLevel: 'medium',
                confirmationRequired: true,
              },
            ],
            views: [],
          },
          dependencies: [
            {
              id: 'workspace-tools',
              displayName: 'Workspace Tools',
              tone: 'ready' as const,
              installDir: 'managed-package:workspace-tools',
              resolvedInstallDir: 'managed-package:workspace-tools',
              description: '同步工具已准备。',
              health: {
                state: 'ready' as const,
                label: '服务可用',
                summary: '声明依赖已就绪。',
                checkedAt: Date.now(),
              },
            },
          ],
          logState: {
            lastEvent: 'started' as TestExtensionEvent,
            message: '扩展已启动。',
          },
        },
      ],
    };
    const skillCatalogSnapshot = {
      generatedAt: new Date().toISOString(),
      totalSkills: 3,
      providerCounts: { core: 2, extension: 1, mcp_server: 0, user: 0 },
      runtimeStatusCounts: { ready: 2, contract_only: 1 },
      totalTools: 4,
      totalResources: 0,
      totalPrompts: 0,
      providerRuntimes: [
        {
          provider: { kind: 'core', id: 'core' },
          state: 'ready' as const,
          display_name: 'Core Desktop',
          summary: '桌面内建能力已就绪。',
          skill_count: 2,
          tool_count: 3,
          resource_count: 0,
          prompt_count: 0,
          updated_at: new Date().toISOString(),
          recovery_actions: [],
        },
        {
          provider: { kind: 'extension', id: 'workspace-bridge' },
          state: 'contract_only' as const,
          display_name: 'Workspace Bridge',
          summary: '扩展声明可用，运行时由扩展宿主管理。',
          skill_count: 1,
          tool_count: 1,
          resource_count: 0,
          prompt_count: 0,
          updated_at: new Date().toISOString(),
          recovery_actions: [],
        },
      ],
      entries: [
        {
          id: 'core.desktop',
          name: '桌面能力',
          description: '打开链接、通知和桌面交互。',
          provider: { kind: 'core', id: 'core' },
          tools: [
            { name: 'desktop.open_url', description: '打开 URL。', parameters: {} },
            { name: 'notification.show', description: '显示通知。', parameters: {} },
          ],
          resources: [],
          prompts: [],
          policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['desktop'], audit: true },
          metadata: { runtime_status: 'ready' },
        },
        {
          id: 'core.clipboard',
          name: '剪贴板',
          description: '读取和写入系统剪贴板。',
          provider: { kind: 'core', id: 'core' },
          tools: [
            { name: 'clipboard.read', description: '读取剪贴板。', parameters: {} },
          ],
          resources: [],
          prompts: [],
          policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['clipboard'], audit: true },
          metadata: { runtime_status: 'ready' },
        },
        {
          id: 'extension.workspace-bridge.sync',
          name: '工作台同步',
          description: 'Workspace Bridge 声明的同步能力。',
          provider: { kind: 'extension', id: 'workspace-bridge' },
          tools: [{ name: 'workspace.sync_status', description: '读取同步状态。', parameters: {} }],
          resources: [],
          prompts: [],
          policy: { riskLevel: 'medium', confirmationRequired: true, sideEffects: ['network'], audit: true },
          metadata: { runtime_status: 'contract_only' },
        },
      ],
    };
    const observabilityRecentErrors = [
      {
        trace_id: 'trace-ui-001',
        timestamp: '2026-07-07T08:10:00.000Z',
        source: 'llm' as const,
        title: 'openai-compatible / selrena-test-model',
        summary: 'provider timeout while generating reply',
        owner: 'cognition',
        runtime_id: 'cognition',
        outcome: 'failed',
        error_code: 'provider_timeout',
        process_log_refs: [
          {
            id: 'cognition',
            owner: 'cognition',
            label: 'Cognition process log',
            source: 'known_process' as const,
            path: 'data/observability/logs/application/cognition.console.log',
            exists: true,
          },
        ],
      },
    ];
    const observabilityTraceProjection = {
      generated_at: '2026-07-07T08:12:00.000Z',
      trace_id: 'trace-ui-001',
      storage: {
        mode: 'sqlite_index' as const,
        owner: 'desktop-main' as const,
        index_path: 'data/observability/index/observability.db',
        pending_index_path: null,
        refreshed_at: '2026-07-07T08:12:00.000Z',
        source_fingerprint: 'fingerprint-ui-001',
        recovery_note: 'JSONL scanning is the recovery path for the SQLite projection.',
      },
      events: [
        {
          timestamp: '2026-07-07T08:10:00.000Z',
          level: 'warn',
          event_type: 'skill.invocation.failed',
          event_action: 'invoke',
          event_outcome: 'failed',
          owner: 'skill_plane',
          module: 'skill-invocation-gateway',
          runtime_id: 'kernel',
          phase: 'invoke',
          trace_id: 'trace-ui-001',
          error_code: 'provider_timeout',
          diagnostic_hint: 'check cognition provider timeout',
          details_ref: 'data/observability/logs/application/cognition.console.log',
          artifact_ref: null,
          extension_id: null,
          provider_id: 'openai-compatible',
        },
      ],
      audit: [
        {
          timestamp: '2026-07-07T08:10:01.000Z',
          action: 'desktop.open_url',
          target_kind: 'core_skill_action',
          target_name: 'desktop.open_url',
          owner: 'desktop',
          runtime_id: 'desktop:123',
          trace_id: 'trace-ui-001',
          outcome: 'failed',
          reason: 'local endpoint not ready',
          diagnostic_hint: 'start dashboard',
          details_ref: null,
          artifact_ref: null,
          extension_id: null,
          provider_id: null,
        },
      ],
      llm: [
        {
          timestamp: '2026-07-07T08:10:02.000Z',
          invocation_id: 'llm-001',
          trace_id: 'trace-ui-001',
          purpose: 'reply',
          capture_mode: 'summary',
          owner: 'cognition',
          runtime_id: 'cognition',
          provider_id: 'openai-compatible',
          model_id: 'selrena-test-model',
          outcome: 'failed',
          duration_ms: 3200,
          prompt_chars: 240,
          response_chars: 0,
          prompt_hash: 'abc123',
          response_hash: null,
          error_code: 'provider_timeout',
          error_summary: 'provider timeout while generating reply',
        },
      ],
      dlq: [
        {
          id: 7,
          trace_id: 'trace-ui-001',
          event_type: 'llm.invocation.failed',
          owner: 'kernel',
          failure_phase: 'dispatch',
          error_code: 'provider_timeout',
          status: 'pending',
          created_at: '2026-07-07T08:10:03.000Z',
          resolved_at: null,
          resolution: null,
          diagnostic_hint: 'retry after provider recovers',
          redacted_payload_summary: '{"purpose":"reply"}',
          replay_command: 'python scripts/dlq.py replay --id 7',
          source_path: 'data/observability/logs/application/cognition.console.log',
        },
      ],
      spans: [
        {
          source: 'kernel' as const,
          name: 'llm.request',
          trace_id: 'trace-ui-001',
          span_id: 'span-kernel-1',
          parent_span_id: null,
          started_at: '2026-07-07T08:10:00.000Z',
          ended_at: '2026-07-07T08:10:03.000Z',
          duration_ms: 3000,
          status: 'error',
          file_ref: 'data/observability/traces/kernel.jsonl',
        },
      ],
      process_log_refs: [
        {
          id: 'cognition',
          owner: 'cognition',
          label: 'Cognition process log',
          source: 'known_process' as const,
          path: 'data/observability/logs/application/cognition.console.log',
          exists: true,
        },
      ],
      metric_refs: [
        {
          id: 'kernel-metrics',
          source: 'kernel' as const,
          path: 'data/observability/metrics/kernel.jsonl',
          note: 'trace_id is not a metric label',
        },
      ],
      related_runtime_ids: ['kernel', 'cognition', 'desktop:123'],
      related_extensions: [],
      related_providers: ['openai-compatible'],
      notes: [
        'Renderer consumes IPC projection only.',
        'trace_id stays query-only, not a metric label.',
      ],
    };
    const observabilityMaintenance = {
      generated_at: '2026-07-07T08:12:30.000Z',
      storage: structuredClone(observabilityTraceProjection.storage),
      retention: {
        events_days: 14,
        traces_days: 14,
        metrics_days: 14,
        audit_days: 30,
        model_invocation_days: 14,
        model_invocation_capture_days: 3,
        application_log_days: 7,
        dlq_days: 30,
        bundles_days: 7,
        bundle_export_dir: 'data/observability/bundles',
        include_model_invocation_captures: false,
        process_tail_bytes: 8192,
      },
      model_invocation_capture_mode: 'summary' as const,
      notes: [
        'Desktop main serves diagnostics from observability.db.',
        'Cleanup excludes Cognition state and Experience.',
      ],
    };
    const observabilityBundleResult = {
      trace_id: 'trace-ui-001',
      bundle_id: 'bundle-trace-ui-001',
      exported_at: '2026-07-07T08:13:00.000Z',
      bundle_root: 'data/observability/bundles/bundle-trace-ui-001',
      manifest_path: 'data/observability/bundles/bundle-trace-ui-001/manifest.json',
      included_sections: ['trace-summary', 'events', 'audit', 'model-invocation-records', 'dlq-summary', 'process-log-refs', 'runtime-summary', 'process-tails'],
      process_log_snippets: 1,
      model_invocation_captures: 0,
      storage: structuredClone(observabilityTraceProjection.storage),
      notes: ['No full prompt included.'],
    };
    const observabilityCleanupResult = {
      executed_at: '2026-07-07T08:14:00.000Z',
      storage: structuredClone(observabilityTraceProjection.storage),
      retention: structuredClone(observabilityMaintenance.retention),
      buckets: [
        {
          id: 'events' as const,
          retention_days: 14,
          deleted_records: 2,
          deleted_files: 0,
          reclaimed_bytes: 512,
          note: 'old events removed',
        },
        {
          id: 'index' as const,
          retention_days: 0,
          deleted_records: 0,
          deleted_files: 1,
          reclaimed_bytes: 4096,
          note: 'index reset',
        },
      ],
      protected_paths: ['data/state/cognition/**'],
      notes: ['Pending DLQ rows are preserved.'],
    };
    const unsubscribe = (): (() => void) => () => undefined;

    const api = {
      sendPerception: async (): Promise<void> => undefined,
      getConnectionStatus: async () => ({ status: 'online' as const }),
      getRuntimeReadiness: async () => structuredClone(runtimeReadinessCatalog),
      getObservabilityRecentErrors: async () => structuredClone(observabilityRecentErrors),
      getObservabilityRecentEvents: async () => structuredClone(observabilityTraceProjection.events),
      getObservabilityMaintenance: async () => structuredClone(observabilityMaintenance),
      getObservabilityTrace: async (traceId: string) => {
        if (traceId !== 'trace-ui-001') {
          throw new Error('trace not found');
        }
        return structuredClone(observabilityTraceProjection);
      },
      exportObservabilityBundle: async (traceId: string) => {
        if (traceId !== 'trace-ui-001') {
          throw new Error('trace not found');
        }
        return structuredClone(observabilityBundleResult);
      },
      cleanupObservability: async () => structuredClone(observabilityCleanupResult),
      getAudioStatus: async () => ({
        updated_at: Date.now(),
        tts: {
          enabled: true,
          active_provider: 'dashscope-cosyvoice',
          route_state: 'ready' as const,
          providers: [{ provider_id: 'dashscope-cosyvoice', role: 'primary' as const, execution: 'cloud' as const, status: 'ready' as const, message: 'CosyVoice 已就绪' }],
        },
        asr: {
          enabled: true,
          active_provider: 'funasr',
          route_state: 'ready' as const,
          providers: [{ provider_id: 'funasr', role: 'primary' as const, execution: 'local' as const, status: 'ready' as const, message: 'FunASR 已就绪' }],
        },
      }),
      getControlCenterSettings: async () => structuredClone(settings),
      getMemoryPreview: async () => ({
        updatedAt: Date.now(),
        metrics: {
          previewItems: 3,
          conversationMessages: 2,
          experienceMoments: 8,
          episodes: 2,
          pendingConsolidationEpisodes: 0,
          completedConsolidations: 1,
          emptyConsolidations: 0,
          failedConsolidations: 0,
          activeMemories: 1,
          memoryRevisions: 1,
          memoryEvidenceLinks: 1,
          knowledgeEntries: 1,
          durableRecords: 9,
          previewedMemories: 0,
          sourceNotes: [
            '经历 Moment 已进入不可变 Ledger，可作为 Episode 投影、记忆巩固与审计证据。',
          ],
        },
        items: [
          {
            id: 'conversation-message-1',
            source: 'conversation_message' as const,
            title: 'Conversation / QQ群 197432710',
            body: '群聊中的可重建会话消息。',
            timestamp: '2026-07-03T06:20:00.000Z',
          },
          {
            id: 'exp-1',
            source: 'experience_moment' as const,
            title: 'Moment',
            body: '测试经历预览内容。',
            timestamp: '2026-06-30T12:00:00.000Z',
          },
          {
            id: 'kb-1',
            source: 'role_knowledge' as const,
            title: '角色资料',
            body: '角色资料库索引会把可检索知识组织成可读正文预览。',
          },
        ],
      }),
      saveControlCenterSettings: async (next: typeof initialSettings) => {
        settings = structuredClone(next);
        return { status: 'saved' as const, message: '测试配置已保存。' };
      },
      getExtensions: async () => structuredClone(extensionsSnapshot),
      getSkillCatalog: async () => ({
        status: 'success' as const,
        snapshot: structuredClone(skillCatalogSnapshot),
        message: '',
      }),
      saveExtensionConfig: async ({ extensionId, configYaml }: { extensionId: string; configYaml: string }) => {
        extensionsSnapshot = {
          ...extensionsSnapshot,
          extensions: extensionsSnapshot.extensions.map((extension) => (
            extension.id === extensionId ? { ...extension, configYaml } : extension
          )),
        };
        return structuredClone(extensionsSnapshot);
      },
      setExtensionEnabled: async ({ extensionId, enabled }: { extensionId: string; enabled: boolean }) => {
        extensionsSnapshot = {
          ...extensionsSnapshot,
          extensions: extensionsSnapshot.extensions.map((extension) => (
            extension.id === extensionId ? { ...extension, enabled } : extension
          )),
        };
        return structuredClone(extensionsSnapshot);
      },
      requestExtensionLifecycle: async ({ extensionId, operation }: { extensionId: string; operation: string }) => {
        extensionsSnapshot = {
          ...extensionsSnapshot,
          extensions: extensionsSnapshot.extensions.map((extension) => (
            extension.id === extensionId
              ? {
                  ...extension,
                  running: operation === 'start',
                  operationalState: operation === 'start' ? 'ready' : 'stopped',
                  operationalSummary: operation === 'start'
                    ? '扩展宿主和声明依赖均已就绪。'
                    : '扩展已关闭。',
                  logState: {
                    lastEvent: operation === 'start' ? 'started' : 'stopped',
                    message: operation === 'start' ? '扩展已启动。' : '扩展已关闭。',
                  },
                }
              : extension
          )),
        };
      },
      executeExtensionCommand: async ({ commandId }: { commandId: string }) => {
        if (commandId === 'workspace-bridge.getStatus') {
          return {
            result: {
              status: 'ready',
              lastSync: '刚刚',
              items: 24,
              profile: '示例工作台',
            },
          };
        }
        if (commandId === 'workspace-bridge.openDashboard') {
          return {
            status: 'success' as const,
            message: '已打开链接。',
            result: {
              url: 'http://127.0.0.1:6099/webui',
              opened: true,
            },
          };
        }
        return { result: null };
      },
      getAvatarAppearance: async () => structuredClone(appearance),
      getAvatarPackageCatalog: async () => structuredClone(avatarPackageCatalog),
      getCharacterPresentationProjection: async () => structuredClone(characterPresentationProjection),
      setAvatarAppearance: async (next: typeof appearance) => {
        appearance = structuredClone(next);
        return structuredClone(appearance);
      },
      resetAvatarPlacement: async () => undefined,
      getAvatarManualActions: async () => [
        {
          id: 'accessory.fan.visible',
          label: '拿扇子',
          category: 'accessory',
          manualOnly: false,
          toggle: true,
          requires: [],
        },
        {
          id: 'accessory.fan.open',
          label: '打开扇子',
          category: 'accessory',
          manualOnly: false,
          toggle: true,
          requires: ['accessory.fan.visible'],
        },
      ],
      getAvatarActionState: async () => structuredClone(avatarActionState),
      setAvatarAction: async ({ id, operation }: { id: string; operation: string }) => {
        const active = new Set(avatarActionState.activeActionIds);
        if (operation === 'activate') active.add(id);
        if (operation === 'deactivate') active.delete(id);
        avatarActionState = { activeActionIds: [...active] };
        writeAvatarActionState(avatarActionState);
        avatarActionStateListener?.(structuredClone(avatarActionState));
      },
      getAvatarDiagnostics: async () => ({
        enabled: true,
        launchMode: 'managed',
        command: 'managed-avatar',
        cwd: 'managed-avatar',
        commandPath: 'managed-avatar',
        commandExists: false,
        unityProjectPath: 'managed-avatar-project',
        avatarPackageDir: 'managed-avatar-package',
        avatarSdkPackageDir: 'managed-avatar-resources',
        assetRegistryPath: 'managed-avatar-registry',
        assetRegistryExists: true,
        buildLogPath: 'managed-build-log',
        processLogPath: 'managed-process-log',
        requiredSdks: [
          {
            id: 'cubism-unity',
            displayName: 'Live2D Cubism 资源包',
            modelFormats: ['cubism4', 'cubism5'],
            status: 'supported',
            sourcePath: 'managed-live2d-resource',
            sourceEnv: 'GLIMMER_CRADLE_LIVE2D_RESOURCE',
            resolvedSourcePath: 'managed-live2d-resource',
            targetPath: 'managed-live2d-target',
            installed: false,
            artifactCount: 1,
            installHint: '资源包已准备，等待导入。',
            licenseNote: '资源授权需确认。',
          },
        ],
        tone: 'error' as const,
        summary: '形象资源包已准备，尚未导入。',
        nextAction: '完成资源准备后刷新状态。',
      }),
      sendAudioInput: async (): Promise<void> => undefined,
      onReply: unsubscribe,
      onEmotionUpdate: unsubscribe,
      onThoughtUpdate: unsubscribe,
      onConnectionStatus: unsubscribe,
      onAvatarStatus: unsubscribe,
      onAudioPlay: unsubscribe,
      onAudioStatus: unsubscribe,
      onRuntimeReadiness: unsubscribe,
      onAudioTranscript: unsubscribe,
      onAvatarAppearance: unsubscribe,
      onCharacterPresentationProjection: unsubscribe,
      onExtensionStatusChanged: unsubscribe,
      onAvatarActionState: (callback: (state: typeof avatarActionState) => void) => {
        avatarActionStateListener = callback;
        return () => {
          if (avatarActionStateListener === callback) avatarActionStateListener = null;
        };
      },
      openControlCenter: async (): Promise<void> => undefined,
      minimizeWindow: async (): Promise<void> => undefined,
      toggleMaximizeWindow: async (): Promise<void> => undefined,
      closeWindow: async (): Promise<void> => undefined,
      openDiagnosticLocation: async (): Promise<void> => undefined,
      updatePresenceHitRegion: async (): Promise<void> => undefined,
      setPresenceInteractionPolicy: async (): Promise<void> => undefined,
      beginPresenceDrag: (): void => undefined,
      movePresenceWindowTo: (): void => undefined,
      endPresenceDrag: (): void => undefined,
    };

    Object.defineProperty(window, 'desktopHost', {
      configurable: true,
      value: api,
    });
  }, settingsSnapshot);
}
