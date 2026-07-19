/* 自动生成 — 从 ConfigurationUpdateResult.schema.json 生成，勿手动修改 */

import type { ConfigurationSnapshot } from './ConfigurationSnapshot';

export interface ConfigurationUpdateResult {
  request_id: string;
  status: 'preview' | 'success' | 'conflict' | 'error';
  apply_state: 'unchanged' | 'restart_required' | 'restarting' | 'completed' | 'failed';
  new_revision?: string;
  change_summary: string[];
  snapshot?: ConfigurationSnapshot;
  message?: string;
}
