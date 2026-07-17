/**
 * AJV 配置校验器，由 protocol 包统一拥有并供各消费者复用。
 *
 * 设计：所有 14 份 schemas/config/*.schema.json 通过 ConfigSchemas 静态导出注入
 * ajv 实例；ajv 以 ``useDefaults`` 模式自动填默认值；``additionalProperties``
 * 由各 schema 自身的 ``additionalProperties:false`` 控制。
 *
 * 用法（任何 TS 包均可）：
 *   import { validateConfig } from '@glimmer-cradle/protocol';
 *   const result = validateConfig('CharacterManifestConfig', manifestData);
 *   if (!result.ok) throw new Error(result.errors.join('; '));
 *
 * 注意：``data`` 会被 ajv 原地修改（填默认值），调用方应假定 data 内容被覆写。
 */
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { ConfigSchemas, type ConfigSchemaName } from '../config-schemas';

export type { ConfigSchemaName };

const ajv = new Ajv({
  useDefaults: true,
  allErrors: true,
  strict: false, // 容忍 description 等 metadata 关键字
  removeAdditional: false, // additionalProperties:false 失败则报错（不是默默删）
});
addFormats(ajv);

// 一次性把所有 schema 装进 ajv —— $id 索引，便于 $ref 解析（如有）。
for (const schema of Object.values(ConfigSchemas)) {
  ajv.addSchema(schema);
}

const compiledCache = new Map<ConfigSchemaName, ValidateFunction>();

function compile(name: ConfigSchemaName): ValidateFunction {
  let v = compiledCache.get(name);
  if (!v) {
    v = ajv.compile(ConfigSchemas[name]);
    compiledCache.set(name, v);
  }
  return v;
}

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors: string[];
}

/**
 * 校验并填默认值（原地修改 data）。
 *
 * @param name   schemas/config/ 中的 schema 名称
 * @param data   待校验对象（可能被 ajv 原地修改：填默认值）
 * @returns      ok 标志 + 错误列表；ok=true 时 data 字段就是 input data
 */
export function validateConfig<T = unknown>(
  name: ConfigSchemaName,
  data: unknown,
): ValidationResult<T> {
  const validate = compile(name);
  const ok = validate(data) as boolean;
  if (!ok) {
    const errors = (validate.errors ?? []).map(
      (err) => `${err.instancePath || '/'}: ${err.message ?? 'unknown'}`,
    );
    return { ok: false, errors };
  }
  return { ok: true, data: data as T, errors: [] };
}
