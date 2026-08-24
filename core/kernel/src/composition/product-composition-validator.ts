import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import type { ProductComposition } from './product-composition-document';
import ProductCompositionSchema from '@glimmer-cradle/contracts/json-schema/product/v1/product-composition.schema.json';

export interface ProductCompositionValidation {
  ok: boolean;
  data?: ProductComposition;
  errors: string[];
}

const ajv = new Ajv2020({ useDefaults: true, allErrors: true, strict: false, removeAdditional: false });
const validator = ajv.compile(ProductCompositionSchema) as ValidateFunction;

export function validateProductComposition(value: unknown): ProductCompositionValidation {
  if (!validator(value)) {
    return {
      ok: false,
      errors: (validator.errors ?? []).map(
        (error) => `${error.instancePath || '/'}: ${error.message ?? 'unknown'}`,
      ),
    };
  }
  return { ok: true, data: value as ProductComposition, errors: [] };
}
