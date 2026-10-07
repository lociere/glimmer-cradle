/** Host 核验的运行期主体；id 不是凭证，generation 不能由调用方自报取得。 */
export interface Principal {
  readonly principal_id: string;
  readonly host_id: string;
  readonly generation: string;
  readonly kind: 'user' | 'character' | 'extension' | 'service';
}

export function validateSecurityIdentity(value: string): void {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 4096) {
    throw new Error('Security identity 无效');
  }
}

export function snapshotPrincipal(value: Principal): Principal {
  for (const id of [value.principal_id, value.host_id, value.generation]) validateSecurityIdentity(id);
  if (!['user', 'character', 'extension', 'service'].includes(value.kind)) throw new Error('Principal kind 无效');
  return Object.freeze({ principal_id: value.principal_id, host_id: value.host_id, generation: value.generation, kind: value.kind });
}
