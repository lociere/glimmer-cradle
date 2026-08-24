/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ConfigurationTestResult {
  request_id: string;
  status: 'success' | 'error';
  message: string;
  discovered_models: string[];
  latency_ms?: number;
}
