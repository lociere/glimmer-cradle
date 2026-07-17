import Ajv, { type ValidateFunction } from 'ajv';
import type { ProductComposition } from '../generated/models/ProductComposition';
import ProductCompositionSchema from '../schemas/models/ProductComposition.schema.json';

export interface ProductCompositionValidation {
  ok: boolean;
  data?: ProductComposition;
  errors: string[];
}

const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false, removeAdditional: false });
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
