/* 自动生成 — 从 VoiceConfig.schema.json 生成，勿手动修改 */

/**
 * 角色声音身份。只描述稳定声线、语言、表达和供应商绑定，不包含系统路由或密钥。
 */
export interface VoiceConfig {
  profile_id: string;
  language: string;
  style_instruction: string;
  prosody: VoiceProsodyConfig;
  bindings: VoiceBindingsConfig;
}
export interface VoiceProsodyConfig {
  rate: number;
  pitch: number;
  volume: number;
}
export interface VoiceBindingsConfig {
  'dashscope-cosyvoice': CloudVoiceBinding;
}
export interface CloudVoiceBinding {
  /**
   * 云平台创建或复刻后得到的稳定 voice id；未创建时保持空字符串。
   */
  voice_id: string;
}
