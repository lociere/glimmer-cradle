import { ConfigurationValidator, type ConfigurationValidation } from '@glimmer-cradle/platform/configuration';
import type { ProductComposition } from './product-composition-document';
import ProductCompositionSchema from '@glimmer-cradle/contracts/json-schema/product/v1/product-composition.schema.json';

export type ProductCompositionValidation = ConfigurationValidation<ProductComposition>;

const validator = new ConfigurationValidator({ ProductComposition: ProductCompositionSchema });

export function validateProductComposition(value: unknown): ProductCompositionValidation {
  return validator.validate<ProductComposition>('ProductComposition', value);
}
