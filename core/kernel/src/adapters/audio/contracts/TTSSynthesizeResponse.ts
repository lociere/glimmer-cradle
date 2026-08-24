/* Kernel Audio Adapter owner-local projection；generated DTO 只在 gRPC transport edge。 */

export interface TTSSynthesizeResponse {
  status: 'success' | 'error';
  output_path?: string;
  provider_id?: string;
  fallback_used?: boolean;
  duration_ms?: number;
  message?: string;
}
