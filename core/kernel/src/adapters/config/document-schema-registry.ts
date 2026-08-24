/**
 * 配置 JSON Schema 集合导出（阶段 P.4b 起为 TypeScript 端 ajv 校验的事实源）
 *
 * 设计：本模块通过 `resolveJsonModule` 静态 import 所有 schemas/config/*.schema.json，
 * 让 Kernel ConfigManager 从本 owner adapter 取得 canonical Document registry，
 * 拿到全部配置 schema，无需运行时文件 IO。
 *
 * runtime schema 只从 Contract Spine JSON Schema 装配，不建立第二份 schema。
 */
import AppConfig from '@glimmer-cradle/contracts/json-schema/config/v1/app-config.schema.json';
import AudioConfig from '@glimmer-cradle/contracts/json-schema/config/v1/audio-config.schema.json';
import AvatarConfig from '@glimmer-cradle/contracts/json-schema/config/v1/avatar-config.schema.json';
import CharacterManifestConfig from '@glimmer-cradle/contracts/json-schema/config/v1/character-manifest-config.schema.json';
import CharacterProfileConfig from '@glimmer-cradle/contracts/json-schema/config/v1/character-profile-config.schema.json';
import CognitionConfig from '@glimmer-cradle/contracts/json-schema/config/v1/cognition-config.schema.json';
import CognitionServiceConfig from '@glimmer-cradle/contracts/json-schema/config/v1/cognition-service-config.schema.json';
import DialoguePolicyConfig from '@glimmer-cradle/contracts/json-schema/config/v1/dialogue-policy-config.schema.json';
import EmbeddingConfig from '@glimmer-cradle/contracts/json-schema/config/v1/embedding-config.schema.json';
import ExtensionConfig from '@glimmer-cradle/contracts/json-schema/config/v1/extension-config.schema.json';
import IngressGateConfig from '@glimmer-cradle/contracts/json-schema/config/v1/ingress-gate-config.schema.json';
import InferenceConfig from '@glimmer-cradle/contracts/json-schema/config/v1/inference-config.schema.json';
import KnowledgeBaseConfig from '@glimmer-cradle/contracts/json-schema/config/v1/knowledge-base-config.schema.json';
import KnowledgeIndexConfig from '@glimmer-cradle/contracts/json-schema/config/v1/knowledge-index-config.schema.json';
import LLMConfig from '@glimmer-cradle/contracts/json-schema/config/v1/llm-config.schema.json';
import LifecycleConfig from '@glimmer-cradle/contracts/json-schema/config/v1/lifecycle-config.schema.json';
import MemoryConfig from '@glimmer-cradle/contracts/json-schema/config/v1/memory-config.schema.json';
import ObservabilityConfig from '@glimmer-cradle/contracts/json-schema/config/v1/observability-config.schema.json';
import SurfaceConfig from '@glimmer-cradle/contracts/json-schema/config/v1/surface-config.schema.json';
import SafetyConfig from '@glimmer-cradle/contracts/json-schema/config/v1/safety-config.schema.json';
import SkillPlaneConfig from '@glimmer-cradle/contracts/json-schema/config/v1/skill-plane-config.schema.json';
import VoiceConfig from '@glimmer-cradle/contracts/json-schema/config/v1/voice-config.schema.json';

export const ConfigSchemas = {
  AppConfig,
  AudioConfig,
  AvatarConfig,
  CharacterManifestConfig,
  CharacterProfileConfig,
  CognitionConfig,
  CognitionServiceConfig,
  DialoguePolicyConfig,
  EmbeddingConfig,
  ExtensionConfig,
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
