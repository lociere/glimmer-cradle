/**
 * 配置 JSON Schema 集合导出（阶段 P.4b 起为 TypeScript 端 ajv 校验的事实源）
 *
 * 设计：本模块通过 `resolveJsonModule` 静态 import 所有 schemas/config/*.schema.json，
 * 让 kernel ConfigManager 可直接 `import { ConfigSchemas } from '@glimmer-cradle/protocol'`
 * 拿到全部配置 schema，无需运行时文件 IO。
 *
 * 与 generated/ 关系：generated/config/*.ts 是 codegen 出的 TS 接口（消费者用
 * `import type {...} from generated/config`）；本模块是运行时 ajv 校验的源数据。
 * 两者同源（同一 .schema.json），只是消费形态不同。
 */
import AppConfig from './schemas/config/AppConfig.schema.json';
import AudioConfig from './schemas/config/AudioConfig.schema.json';
import AvatarConfig from './schemas/config/AvatarConfig.schema.json';
import CharacterManifestConfig from './schemas/config/CharacterManifestConfig.schema.json';
import CharacterProfileConfig from './schemas/config/CharacterProfileConfig.schema.json';
import CognitionConfig from './schemas/config/CognitionConfig.schema.json';
import DialoguePolicyConfig from './schemas/config/DialoguePolicyConfig.schema.json';
import EmbeddingConfig from './schemas/config/EmbeddingConfig.schema.json';
import ExtensionConfig from './schemas/config/ExtensionConfig.schema.json';
import IPCConfig from './schemas/config/IPCConfig.schema.json';
import IngressGateConfig from './schemas/config/IngressGateConfig.schema.json';
import InferenceConfig from './schemas/config/InferenceConfig.schema.json';
import KnowledgeBaseConfig from './schemas/config/KnowledgeBaseConfig.schema.json';
import KnowledgeIndexConfig from './schemas/config/KnowledgeIndexConfig.schema.json';
import LLMConfig from './schemas/config/LLMConfig.schema.json';
import LifecycleConfig from './schemas/config/LifecycleConfig.schema.json';
import MemoryConfig from './schemas/config/MemoryConfig.schema.json';
import ObservabilityConfig from './schemas/config/ObservabilityConfig.schema.json';
import SurfaceConfig from './schemas/config/SurfaceConfig.schema.json';
import SafetyConfig from './schemas/config/SafetyConfig.schema.json';
import SkillPlaneConfig from './schemas/config/SkillPlaneConfig.schema.json';
import VoiceConfig from './schemas/config/VoiceConfig.schema.json';

export const ConfigSchemas = {
  AppConfig,
  AudioConfig,
  AvatarConfig,
  CharacterManifestConfig,
  CharacterProfileConfig,
  CognitionConfig,
  DialoguePolicyConfig,
  EmbeddingConfig,
  ExtensionConfig,
  IPCConfig,
  IngressGateConfig,
  InferenceConfig,
  KnowledgeBaseConfig,
  KnowledgeIndexConfig,
  LLMConfig,
  LifecycleConfig,
  MemoryConfig,
  ObservabilityConfig,
  SurfaceConfig,
  SafetyConfig,
  SkillPlaneConfig,
  VoiceConfig,
} as const;

export type ConfigSchemaName = keyof typeof ConfigSchemas;
