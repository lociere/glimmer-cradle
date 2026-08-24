import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateProductComposition } from './product-composition-validator';
import type { ProductComposition } from './product-composition-document';
import { resolveRepoRoot } from '../adapters/filesystem/path-utils';

export type { ProductComposition } from './product-composition-document';

export function loadProductComposition(): ProductComposition {
  const repoRoot = resolveRepoRoot();
  const configuredPath = process.env.GLIMMER_CRADLE_PRODUCT_MANIFEST?.trim();
  const manifestPath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(repoRoot, 'products', 'desktop', 'product.json');
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  const result = validateProductComposition(parsed);
  if (!result.ok || !result.data) {
    throw new Error(`产品组合清单不符合 Protocol: ${manifestPath}: ${result.errors.join('; ')}`);
  }
  return result.data;
}
