/* 自动生成 — 从 InferenceConfig.schema.json 生成，勿手动修改 */

/**
 * 角色推理参数（跨语言 ABI 契约）—— 包含生成参数、生命时钟、多模态与动作流。模型能力 Provider 由系统配置拥有。
 */
export interface InferenceConfig {
  model: ModelConfig;
  life_clock: LifeClockConfig;
  multimodal: MultimodalConfig;
  action_stream: ActionStreamConfig;
}
/**
 * 模型生成参数
 */
export interface ModelConfig {
  /**
   * 单次生成最大 token 数
   */
  max_tokens: number;
  /**
   * 采样温度（0 = 确定性，2 = 最大随机）
   */
  temperature: number;
  /**
   * 核采样概率阈值
   */
  top_p: number;
  /**
   * 频率惩罚因子
   */
  frequency_penalty: number;
}
/**
 * 生命时钟配置。只负责 Cognition 活性探测，不拥有认知节律、注意力模式或活动状态决策。
 */
export interface LifeClockConfig {
  /**
   * 是否启用 Kernel 到 Cognition 的活性探测。
   */
  heartbeat_enabled: boolean;
  /**
   * 活性探测的兜底间隔（ms）；收到 Cognition CognitiveActivityPolicy.frequency_hint_ms 后可调整探测频率。
   */
  heartbeat_interval_ms: number;
  /**
   * 焦点模式持续时长（ms）
   */
  focus_duration_ms: number;
  /**
   * 普通消息防抖时间窗口（ms）
   */
  ingress_debounce_ms: number;
  /**
   * 焦点模式下的防抖时间窗口（ms）
   */
  ingress_focused_debounce_ms: number;
  /**
   * 单次批处理最大消息条数
   */
  ingress_max_batch_messages: number;
  /**
   * 单次批处理最大媒体项数
   */
  ingress_max_batch_items: number;
  /**
   * 唤醒关键词列表
   */
  summon_keywords: string[];
  /**
   * 是否任意聊天都触发焦点
   */
  focus_on_any_chat: boolean;
}
/**
 * 多模态处理策略
 */
export interface MultimodalConfig {
  /**
   * 是否启用多模态输入处理
   */
  enabled: boolean;
  /**
   * 处理策略：core_direct = 主模型直接处理；specialist_then_core = 专家预处理后传主模型
   */
  strategy: 'core_direct' | 'specialist_then_core';
  /**
   * 单次请求最大媒体项数
   */
  max_items: number;
  /**
   * 主推理模型名称
   */
  core_model: string;
  /**
   * 图像专家模型名称
   */
  image_model: string;
  /**
   * 视频专家模型名称
   */
  video_model: string;
}
/**
 * 动作流（Live2D 表情 / 动作联动）配置
 */
export interface ActionStreamConfig {
  /**
   * 是否启用动作流
   */
  enabled: boolean;
  /**
   * 渲染通道
   */
  channel: 'live2d';
}
