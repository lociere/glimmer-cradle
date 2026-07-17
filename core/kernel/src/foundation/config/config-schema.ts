/**
 * 全局配置类型聚合（阶段 P.4b 起，从 Zod 推断 → JSON Schema codegen 产物）
 *
 * - system 块：identity / character / backup + Kernel 子块（ipc / lifecycle /
 *   extensions / surfaces / ingress / memory / observability）
 * - character 块：当前 active character package 的 manifest / profile / dialogue / safety / inference / llm 六段
 *
 * 运行时由 ConfigManager 走 ajv 校验填默认值；本文件只承担类型聚合职责。
 */
import type {
  AppConfig,
  AvatarConfig,
  AudioConfig,
  CharacterManifestConfig,
  CharacterProfileConfig,
  DialoguePolicyConfig,
  EmbeddingConfig,
  ExtensionConfig,
  IngressGateConfig,
  IPCConfig,
  InferenceConfig,
  LifecycleConfig,
  LLMConfig,
  MemoryConfig,
  ObservabilityConfig,
  SafetyConfig,
  SurfaceConfig,
  SkillPlaneConfig,
  VoiceConfig,
} from '@glimmer-cradle/protocol';

/** configs/system/*.yaml 组合后的解析结果（系统身份/当前角色/备份 + Kernel 运行时子块） */
export type SystemConfig = AppConfig & {
  ipc: IPCConfig;
  lifecycle: LifecycleConfig;
  extensions: ExtensionConfig;
  avatar: AvatarConfig;
  surfaces: SurfaceConfig;
  skill_plane: SkillPlaneConfig;
  ingress: IngressGateConfig;
  memory: MemoryConfig;
  observability: ObservabilityConfig;
  audio: AudioConfig;
  embedding: EmbeddingConfig;
};

/** configs/characters/<active-id>/*.yaml 组合后的解析结果（角色包 manifest · 作者种子 · 对话策略 · 安全边界 · 推理 · LLM） */
export interface GlobalCharacterConfig {
  manifest: CharacterManifestConfig;
  profile: CharacterProfileConfig;
  dialogue: DialoguePolicyConfig;
  safety: SafetyConfig;
  inference: InferenceConfig;
  voice: VoiceConfig;
  llm?: LLMConfig;
}

/** 运行时全局配置根（system + character） */
export interface GlobalConfig {
  system: SystemConfig;
  character: GlobalCharacterConfig;
}
