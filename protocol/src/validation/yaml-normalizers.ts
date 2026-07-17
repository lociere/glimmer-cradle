/**
 * YAML → JSON 归一化，由 protocol 包统一拥有并供各消费者复用。
 *
 * 在交 ajv 校验前，对 YAML parse 结果做必要的归一化 —— 仅处理 schema 难以
 * 1:1 表达的 YAML → JSON 边界问题。
 *
 * 当前已知需要归一化的 YAML 形态：
 * - `observability.module_levels` 的 `null → {}` 归一
 *   （YAML 空键 `module_levels:` 被 parse 成 null，但 schema 期望 object）
 *
 * 用法（任何 TS 包加载 YAML 后调用）：
 *   import { normalizeSystemYamlNulls } from '@glimmer-cradle/protocol';
 *   const data = yaml.parse(content);
 *   normalizeSystemYamlNulls(data);                // 原地修改
 *   validateConfig('AppConfig', data);             // 然后交 ajv
 *
 * 设计纪律：不要把"业务规则归一化"塞进来 —— 那是 config-processor 的职责。
 * 本模块只处理 YAML/JSON 表达层面的失配。
 */

/**
 * 归一 `system.yaml` parse 结果中的 YAML null。
 *
 * 注：原地修改并返回同一对象（避免深拷贝开销）。
 */
export function normalizeSystemYamlNulls(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  const root = obj as Record<string, unknown>;
  const observability = root.observability as Record<string, unknown> | undefined;
  if (observability && observability.module_levels === null) {
    observability.module_levels = {};
  }
  return root;
}
