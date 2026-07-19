/* 自动生成 — 从 ConfigurationTestResult.schema.json 生成，勿手动修改 */

export interface ConfigurationTestResult {
  request_id: string;
  status: 'success' | 'error';
  message: string;
  discovered_models: string[];
  latency_ms?: number;
}
