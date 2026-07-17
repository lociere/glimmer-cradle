/* 自动生成 — 从 TTSSynthesizeResponse.schema.json 生成，勿手动修改 */

export interface TTSSynthesizeResponse {
  status: 'success' | 'error';
  output_path?: string;
  provider_id?: string;
  fallback_used?: boolean;
  duration_ms?: number;
  message?: string;
}
