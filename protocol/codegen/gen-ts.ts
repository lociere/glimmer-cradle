/**
 * gen-ts.ts —— Schema-First TypeScript 端 codegen（阶段 P.9b，取代 sync_contracts.py 的 TS 部分）
 *
 * 设计原则（阶段 P.9 §五）：
 * - TS 自己写 TS 生成器（自洽）；调 json-schema-to-typescript 的 JS API，
 *   不再 spawn npx
 * - 子目录组织：schemas/<rel>/X.schema.json → generated/<rel>/X.ts
 * - 字符串枚举特殊处理：产 type union + as const 对象（json-schema-to-typescript
 *   原生只产 type，需要 .XXX 形式的值访问要自补）
 * - 有 default 的字段后处理：把 `field?: T` 改 `field: T` —— ajv useDefaults
 *   保证校验后字段必填，TS 类型反映 required-after-validation 形态
 * - 每个子目录与根目录写 index.ts；P.9b 起 config 也进 barrel（Zod 已删，无重名冲突）
 *
 * 用法：
 *   pnpm --filter @glimmer-cradle/protocol gen:ts
 */
import { compile } from "json-schema-to-typescript";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTOCOL_ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(PROTOCOL_ROOT, "src", "schemas");
const TS_OUT_DIR = path.join(PROTOCOL_ROOT, "src", "generated");
const MODELS_BARREL_SKIP = new Set(['SkillCatalogRequest.ts', 'SkillCatalogResponse.ts', 'SkillCatalogSnapshot.ts']);

// ─────────────────────────── 工具 ──────────────────────────────

async function findSchemas(dir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.name.endsWith(".schema.json")) result.push(full);
    }
  }
  await walk(dir);
  // 大小写不敏感排序 —— 与 Python pathlib 的 WindowsPath 默认行为对齐
  return result.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function tsOutFor(schemaPath: string): string {
  const rel = path.relative(SCHEMA_DIR, schemaPath);
  const dir = path.dirname(rel);
  const stem = path.basename(rel).replace(/\.schema\.json$/, "");
  return path.join(TS_OUT_DIR, dir, `${stem}.ts`);
}

function isStringEnum(schema: any): boolean {
  return (
    schema.type === "string" &&
    Array.isArray(schema.enum) &&
    schema.properties === undefined
  );
}

function enumMemberName(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "_").toUpperCase();
}

/** 字符串枚举：产 type union + as const 对象，与 Python 端 StrEnum 对齐。 */
function emitStringEnum(schema: any, schemaFile: string): string {
  const title: string = schema.title;
  const desc: string = schema.description ?? title;
  const values: string[] = schema.enum;
  const lines: string[] = [
    `/* 自动生成 — 从 ${path.basename(schemaFile)} 生成，勿手动修改 */`,
    "",
    `/** ${desc} */`,
    `export type ${title} =`,
  ];
  values.forEach((v, i) => {
    lines.push(`  | '${v}'${i === values.length - 1 ? ";" : ""}`);
  });
  lines.push("");
  lines.push(`/** ${title} 值访问对象（${title}.XXX）。 */`);
  lines.push(`export const ${title} = {`);
  for (const v of values) {
    lines.push(`  ${enumMemberName(v)}: '${v}',`);
  }
  lines.push(`} as const satisfies Record<string, ${title}>;`);
  lines.push("");
  return lines.join("\n");
}

/**
 * 收集 schema 中所有写了 default 的属性名（顶层 + 各 definitions）。
 * 用于 _drop_optional_for_defaulted_fields 后处理。
 */
function collectDefaultedFields(schema: any): Map<string, Set<string>> {
  const fields = new Map<string, Set<string>>();
  function collect(owner: string | undefined, node: any): void {
    if (!owner || !node || typeof node !== "object") return;
    const names = new Set<string>();
    if (node.properties && typeof node.properties === "object") {
      for (const [name, definition] of Object.entries(node.properties)) {
        if (definition && typeof definition === "object" && "default" in definition) names.add(name);
      }
    }
    if (names.size > 0) fields.set(owner, names);
  }

  collect(schema.title, schema);
  for (const defsKey of ["definitions", "$defs"]) {
    const definitions = schema[defsKey];
    if (!definitions || typeof definitions !== "object") continue;
    for (const [name, definition] of Object.entries(definitions)) collect(name, definition);
  }
  return fields;
}

/**
 * 把 TS 输出中的 `field?: T` 改成 `field: T`（仅对 schema 中带 default 的字段）。
 *
 * ajv useDefaults:true 后这些字段都已填值，TS 类型应反映校验后的形态。
 */
function dropOptionalForDefaulted(tsCode: string, defaultedFields: Map<string, Set<string>>): string {
  if (defaultedFields.size === 0) return tsCode;
  let interfaceName: string | undefined;
  let interfaceDepth = 0;
  return tsCode.split("\n").map((line) => {
    const declaration = line.match(/^export interface ([A-Za-z0-9_]+) \{/);
    if (declaration) {
      interfaceName = declaration[1];
      interfaceDepth = 1;
      return line;
    }

    if (interfaceName) {
      const stripped = line.trimStart();
      const colonIdx = stripped.indexOf("?:");
      if (colonIdx > 0) {
        const nameRaw = stripped.slice(0, colonIdx).trim();
        const name = nameRaw.replace(/^['"]|['"]$/g, "");
        if (defaultedFields.get(interfaceName)?.has(name)) {
          const indent = line.slice(0, line.length - stripped.length);
          line = indent + nameRaw + stripped.slice(colonIdx + 1);
        }
      }
      interfaceDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (interfaceDepth === 0) interfaceName = undefined;
    }
    return line;
  }).join("\n");
}

const SHARED_MODEL_NAMES = [
  'AudioConfig',
  'EmbeddingConfig',
  'MemoryConfig',
  'SkillPlaneConfig',
  'CapabilityScope',
  'ConversationContext',
  'ConversationHistoryEntry',
  'ConversationHistoryRequest',
  'ConversationHistoryResult',
  'ConversationNotice',
  'ConfigurationModelAlias',
  'ConfigurationProviderDraft',
  'ConfigurationProviderSnapshot',
  'ConfigurationProviderTestDraft',
  'ConfigurationRouteSnapshot',
  'ConfigurationSnapshot',
  'ConfigurationSnapshotRequest',
  'ConfigurationSnapshotResult',
  'ConfigurationTestRequest',
  'ConfigurationTestResult',
  'ConfigurationUpdateRequest',
  'ConfigurationUpdateResult',
  'ExtensionPermission',
  'ExtensionInstallCommitRequest',
  'ExtensionInstallPrepareRequest',
  'ExtensionInstallPreview',
  'ExtensionInstallResult',
  'ExtensionLifecycleRequest',
  'ExtensionLifecycleResult',
  'ExtensionCommandRequest',
  'ExtensionCommandResult',
  'ExtensionInstallationProjection',
  'ExtensionRuntimeProjection',
  'ExtensionRuntimeProjectionRequest',
  'ExtensionRuntimeProjectionResult',
  'ExtensionStatusChanged',
  'ExtensionUninstallRequest',
  'ExtensionUninstallResult',
  'SkillCatalogRequest',
  'SkillCatalogResponse',
  'SkillCatalogSnapshot',
] as const;

const SHARED_MODEL_DECLARATIONS: Partial<Record<(typeof SHARED_MODEL_NAMES)[number], readonly string[]>> = {
  AudioConfig: [
    'AudioConfig',
    'ASRConfig',
    'TTSConfig',
    'TTSRouteConfig',
    'CircuitBreakerConfig',
    'TTSCacheConfig',
    'TTSProvidersConfig',
    'DashScopeCosyVoiceConfig',
  ],
  EmbeddingConfig: [
    'EmbeddingConfig',
    'EmbeddingRouteConfig',
    'EmbeddingProvidersConfig',
    'DashScopeEmbeddingProviderConfig',
    'LocalEmbeddingProviderConfig',
  ],
  MemoryConfig: [
    'MemoryConfig',
    'WorkingMemoryConfig',
    'ConversationProjectionConfig',
    'ExperienceLedgerConfig',
    'ConsolidationConfig',
    'RetrievalConfig',
  ],
  SkillPlaneConfig: [
    'SkillPlaneConfig',
    'McpServerConfig',
    'UserSkillConfig',
  ],
  SkillCatalogResponse: [
    'SkillCatalogResponse',
  ],
  SkillCatalogSnapshot: [
    'SkillCatalogSnapshot',
    'SkillProviderKind',
    'SkillProviderRuntimeState',
    'SkillAudience',
    'SkillRiskLevel',
    'SkillProviderRuntimeSnapshot',
    'SkillProviderRef',
    'SkillCatalogEntry',
    'SkillToolSummary',
    'SkillResourceSummary',
    'SkillPromptSummary',
    'SkillPolicy',
  ],
  ExtensionRuntimeProjection: [
    'ExtensionRuntimeProjection',
    'LifecycleState',
    'CapabilityNodeState',
    'ActionIntentState',
    'DiagnosticSeverity',
    'ContributionPointDefinitionSnapshot',
    'CapabilityGraphSnapshot',
    'CapabilityGraphNode',
    'ReadinessGateSnapshot',
    'CapabilityGraphEdge',
    'ActionIntentSnapshot',
    'DiagnosticsSnapshot',
    'DiagnosticsEntry',
  ],
};

const SHARED_MODEL_DIRECTORIES: Partial<Record<(typeof SHARED_MODEL_NAMES)[number], string>> = {
  AudioConfig: 'config',
  EmbeddingConfig: 'config',
  MemoryConfig: 'config',
  SkillPlaneConfig: 'config',
  ExtensionPermission: 'extension',
};

function reuseSharedModels(tsCode: string, schema: any, outFile: string): string {
  let stripped = tsCode;
  for (const modelName of SHARED_MODEL_NAMES) {
    if (schema.title === modelName) continue;
    for (const declarationName of SHARED_MODEL_DECLARATIONS[modelName] ?? [modelName]) {
      stripped = stripped.replace(
        new RegExp(
          `export (?:interface ${declarationName} \\{|type ${declarationName} =)[\\s\\S]*?(?=\\nexport (?:type|interface)|$)`,
        ),
        '',
      );
    }
  }
  const imports: string[] = [];
  for (const modelName of SHARED_MODEL_NAMES) {
    if (schema.title === modelName) continue;
    const declarationNames = SHARED_MODEL_DECLARATIONS[modelName] ?? [modelName];
    const used = declarationNames.some((declarationName) => (
      new RegExp(`\\b${declarationName}\\b`).test(stripped)
    ));
    if (!used) continue;
    const sharedFile = path.join(TS_OUT_DIR, SHARED_MODEL_DIRECTORIES[modelName] ?? 'models', modelName);
    let importPath = path.relative(path.dirname(outFile), sharedFile).replaceAll(path.sep, '/');
    if (!importPath.startsWith('.')) importPath = `./${importPath}`;
    imports.push(`import type { ${declarationNames.join(', ')} } from '${importPath}';`);
  }
  if (imports.length === 0) return tsCode;
  stripped = stripped
    .replace(/(?:\n\/\*\*(?:(?!\*\/)[\s\S])*\*\/[ \t\r\n]*)+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
  const lines = stripped.split('\n');
  lines.splice(2, 0, ...imports, '');
  return lines.join('\n');
}

function normalizeRootSchemaRefs(value: unknown, schemaFile: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeRootSchemaRefs(item, schemaFile));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === '$ref' && typeof item === 'string' && item.startsWith('src/schemas/')) {
      result[key] = path.relative(path.dirname(schemaFile), path.join(PROTOCOL_ROOT, item)).replaceAll(path.sep, '/');
    } else {
      result[key] = normalizeRootSchemaRefs(item, schemaFile);
    }
  }
  return result;
}

// ─────────────────────────── 生成器主体 ──────────────────────────

async function generateSchemaTs(schemaFile: string): Promise<void> {
  const outFile = tsOutFor(schemaFile);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  const schemaText = await fs.readFile(schemaFile, "utf-8");
  const schema = JSON.parse(schemaText);
  const banner = `/* 自动生成 — 从 ${path.basename(schemaFile)} 生成，勿手动修改 */`;

  // 字符串枚举单独处理
  if (isStringEnum(schema)) {
    const ts = emitStringEnum(schema, schemaFile);
    await fs.writeFile(outFile, ts, "utf-8");
    console.log(`  [TS-enum] ${path.relative(PROTOCOL_ROOT, schemaFile)}`);
    return;
  }

  // 走 json-schema-to-typescript 的 JS API（不再 spawn npx）
  // 注意：不传 additionalProperties 选项 —— 让库默认（schema 没写时视为开放）
  // 与原 sync_contracts.py 字节级一致；schema 自身写 additionalProperties:false 仍生效
  const compileSchema = normalizeRootSchemaRefs(schema, schemaFile) as typeof schema;
  const ts = await compile(compileSchema, schema.title ?? path.basename(schemaFile, ".schema.json"), {
    bannerComment: banner,
    cwd: path.dirname(schemaFile),
    style: { singleQuote: true },
  });

  // 后处理：带 default 的字段去掉 `?:`
  const defaultedFields = collectDefaultedFields(schema);
  const finalTs = reuseSharedModels(
    dropOptionalForDefaulted(ts, defaultedFields), schema, outFile,
  );

  await fs.writeFile(outFile, finalTs, "utf-8");
  console.log(`  [TS] ${path.relative(PROTOCOL_ROOT, schemaFile)}`);
}

async function generateIndices(): Promise<void> {
  if (!(await pathExists(TS_OUT_DIR))) return;

  const subdirs: string[] = [];
  for (const entry of await fs.readdir(TS_OUT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(TS_OUT_DIR, entry.name);
    const files = (await fs.readdir(subDir))
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && (entry.name !== 'models' || !MODELS_BARREL_SKIP.has(f)))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (files.length === 0) continue;
    const lines = [
      "/* 自动生成 — 子目录契约聚合，勿手动修改 */",
      ...files.map((f) => `export * from './${f.replace(/\.ts$/, "")}';`),
    ];
    await fs.writeFile(path.join(subDir, "index.ts"), lines.join("\n") + "\n", "utf-8");
    subdirs.push(entry.name);
  }

  // 根 index
  const rootFiles = (await fs.readdir(TS_OUT_DIR))
    .filter(async (f) => {
      const stat = await fs.stat(path.join(TS_OUT_DIR, f));
      return stat.isFile() && f.endsWith(".ts") && f !== "index.ts";
    });
  const rootFilesSync: string[] = [];
  for (const f of await fs.readdir(TS_OUT_DIR)) {
    const stat = await fs.stat(path.join(TS_OUT_DIR, f));
    if (stat.isFile() && f.endsWith(".ts") && f !== "index.ts") rootFilesSync.push(f);
  }
  rootFilesSync.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const lines = [
    "/* 自动生成 — 契约导出聚合，勿手动修改 */",
    ...rootFilesSync.map((f) => `export * from './${f.replace(/\.ts$/, "")}';`),
    ...subdirs.map((s) => `export * from './${s}';`),
  ];
  await fs.writeFile(path.join(TS_OUT_DIR, "index.ts"), lines.join("\n") + "\n", "utf-8");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────── 入口 ──────────────────────────────

async function main(): Promise<void> {
  if (!(await pathExists(SCHEMA_DIR))) {
    console.error(`❌ 未找到 schema 目录: ${SCHEMA_DIR}`);
    process.exit(1);
  }
  const schemas = await findSchemas(SCHEMA_DIR);
  if (schemas.length === 0) {
    console.error(`❌ 未找到任何 *.schema.json: ${SCHEMA_DIR}`);
    process.exit(1);
  }

  console.log(`📜 扫描 Schema: ${path.relative(PROTOCOL_ROOT, SCHEMA_DIR)}（共 ${schemas.length} 份）`);
  await fs.rm(TS_OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(TS_OUT_DIR, { recursive: true });
  console.log("── 生成 TypeScript 接口 ──");
  for (const sch of schemas) {
    try {
      await generateSchemaTs(sch);
    } catch (err) {
      console.error(`  ⚠ TS 生成失败 ${path.basename(sch)}: ${(err as Error).message}`);
      throw err;
    }
  }
  console.log("── 生成索引文件 ──");
  await generateIndices();
  console.log("✅ TS 契约同步完成");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
