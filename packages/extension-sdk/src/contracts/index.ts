/**
 * 扩展可见的 Glimmer Cradle 协议投影。
 *
 * SDK 只暴露扩展作者需要理解的稳定公开投影；Kernel、Renderer 与 Cognition 的
 * 内部模型不属于该边界。
 */
export * from './models/public';
export type { AudioConfig } from './config/AudioConfig';
export type { EmbeddingConfig } from './config/EmbeddingConfig';
export type { MemoryConfig } from './config/MemoryConfig';
export type { McpServerConfig, SkillPlaneConfig } from './config/SkillPlaneConfig';
