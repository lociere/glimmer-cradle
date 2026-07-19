/* 自动生成 — 从 ConfigurationSnapshotResult.schema.json 生成，勿手动修改 */

import type { ConfigurationSnapshot } from './ConfigurationSnapshot';

export interface ConfigurationSnapshotResult {
  request_id: string;
  status: 'success' | 'error';
  snapshot?: ConfigurationSnapshot;
  message?: string;
}
