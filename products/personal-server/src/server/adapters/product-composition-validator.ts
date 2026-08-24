import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import ProductCompositionSchema from '@glimmer-cradle/contracts/json-schema/product/v1/product-composition.schema.json';
import type { ProductComposition } from './product-composition-document';

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(ProductCompositionSchema) as ValidateFunction;
export function validateProductComposition(value: unknown): { ok: boolean; data?: ProductComposition; errors: string[] } {
  if (!validate(value)) {
    return { ok: false, errors: (validate.errors ?? []).map((error) => `${error.instancePath || '/'}: ${error.message ?? 'unknown'}`) };
  }
  return { ok: true, data: value as ProductComposition, errors: [] };
}
