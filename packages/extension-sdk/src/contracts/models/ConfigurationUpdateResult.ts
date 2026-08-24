/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

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
