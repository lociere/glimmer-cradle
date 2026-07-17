import { readFileSync } from 'node:fs';
import {
  validateProductComposition,
  type ProductComposition,
} from '@glimmer-cradle/protocol';

export type PersonalServerProductManifest = ProductComposition & { readonly id: 'personal-server' };

export function loadPersonalServerProductManifest(manifestPath: string): PersonalServerProductManifest {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  const result = validateProductComposition(parsed);
  if (!result.ok || !result.data) {
    throw new Error(`Personal Server 产品组合清单不符合 Protocol: ${manifestPath}: ${result.errors.join('; ')}`);
  }
  if (result.data.id !== 'personal-server') {
    throw new Error(`Personal Server 产品组合清单使用了错误产品 ID: ${result.data.id}`);
  }
  return result.data as PersonalServerProductManifest;
}
