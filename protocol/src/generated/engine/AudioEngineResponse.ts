/* 自动生成 — 从 AudioEngineResponse.schema.json 生成，勿手动修改 */

/**
 * Audio Engine 返回 Kernel 的单请求响应帧。
 */
export interface AudioEngineResponse {
  id: string;
  status: 'success' | 'error';
  payload?: {
    [k: string]: unknown;
  };
  error?: {
    code: string;
    message: string;
  };
}
