import Ajv2020, { type AnySchema, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export interface ConfigurationValidation<T> {
  ok: boolean;
  data?: T;
  errors: string[];
}

/** Schema 由调用方注入；校验会原地填充默认值，包括校验失败的输入。 */
export class ConfigurationValidator<Name extends string> {
  private readonly ajv: Ajv2020;
  private readonly compiled = new Map<Name, ValidateFunction>();
  private readonly schemas: Readonly<Record<Name, AnySchema>>;

  public constructor(
    schemas: Readonly<Record<Name, AnySchema>>,
    options: { formats?: boolean } = {},
  ) {
    this.schemas = { ...schemas };
    this.ajv = new Ajv2020({
      useDefaults: true,
      allErrors: true,
      strict: false,
      removeAdditional: false,
    });
    if (options.formats) addFormats(this.ajv);
    // 先注册全集，允许调用方注入的 Schema 通过 $id 互相引用。
    for (const schema of Object.values<AnySchema>(this.schemas)) this.ajv.addSchema(schema);
  }

  public validate<T = unknown>(name: Name, data: unknown): ConfigurationValidation<T> {
    let validate = this.compiled.get(name);
    if (!validate) {
      validate = this.ajv.compile(this.schemas[name]);
      this.compiled.set(name, validate);
    }
    if (!validate(data)) {
      return {
        ok: false,
        errors: (validate.errors ?? []).map(
          (error) => `${error.instancePath || '/'}: ${error.message ?? 'unknown'}`,
        ),
      };
    }
    return { ok: true, data: data as T, errors: [] };
  }
}
