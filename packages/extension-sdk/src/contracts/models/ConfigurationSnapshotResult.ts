/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

import type { ConfigurationSnapshot } from './ConfigurationSnapshot';

export interface ConfigurationSnapshotResult {
  request_id: string;
  status: 'success' | 'error';
  snapshot?: ConfigurationSnapshot;
  message?: string;
}
