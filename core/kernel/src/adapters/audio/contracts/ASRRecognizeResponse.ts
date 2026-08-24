/* Kernel Audio Adapter owner-local projection；generated DTO 只在 gRPC transport edge。 */

export interface ASRRecognizeResponse {
  status: 'success' | 'error';
  text?: string;
  provider_id?: string;
  duration_ms?: number;
  message?: string;
}
