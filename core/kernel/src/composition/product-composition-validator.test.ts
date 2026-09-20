import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProductComposition } from './product-composition-validator';

describe('product composition schema validation', () => {
  it.each(['desktop', 'personal-server'])('accepts the real %s artifact document', (product) => {
    const input = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../products', product, 'product.json'), 'utf8'));
    const result = validateProductComposition(input);
    expect(result.ok).toBe(true);
    expect(result.data).toBe(input);
  });

  it('rejects unknown fields and invalid product identity without removing the input', () => {
    const input = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../products/desktop/product.json'), 'utf8'));
    input.extra = true;
    input.id = 'unknown-product';
    const result = validateProductComposition(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('/: must NOT have additional properties');
    expect(result.errors.some((error) => error.startsWith('/id:'))).toBe(true);
    expect(input.extra).toBe(true);
    expect(result.data).toBeUndefined();
  });
});
