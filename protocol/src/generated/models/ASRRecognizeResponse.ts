/* 自动生成 — 从 ASRRecognizeResponse.schema.json 生成，勿手动修改 */

export interface ASRRecognizeResponse {
  status: 'success' | 'error';
  text?: string;
  provider_id?: string;
  duration_ms?: number;
  message?: string;
}
