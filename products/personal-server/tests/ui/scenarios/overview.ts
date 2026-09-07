import type { RuntimeReadinessCatalog } from '../../../src/server/websocket/runtime-readiness-view';

export const overviewCatalog: RuntimeReadinessCatalog = {
  updated_at: Date.UTC(2026, 8, 7, 8),
  runtimes: [
    { runtime_id: 'kernel.ingress', owner: 'kernel', phase: 'ingress', state: 'ready', blocking: true, summary: '服务入口已就绪。' },
    { runtime_id: 'audio.tts', owner: 'engine', phase: 'capability_plane', state: 'degraded', blocking: false, summary: '语音资源未加载，文字交流仍可使用。', duration_ms: 120, details_ref: 'audio/resources', reconciler: { desired: 'enabled', actual: 'waiting', readiness: 'degraded', resources: [] } },
  ],
};

export const longOverviewCatalog: RuntimeReadinessCatalog = {
  ...overviewCatalog,
  runtimes: Array.from({ length: 24 }, (_, index) => ({
    ...overviewCatalog.runtimes[1], runtime_id: `extension.${'long-resource-name-'.repeat(8)}${index}`,
    summary: '长中文状态说明与 technical identifiers 需要保持可读并允许换行。'.repeat(4),
  })),
};
