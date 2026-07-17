/* 自动生成 — 从 PresentationDownstreamFrame.schema.json 生成，勿手动修改 */

import type { ExtensionInstallPreview } from './ExtensionInstallPreview';
import type { ExtensionInstallResult } from './ExtensionInstallResult';
import type { ExtensionLifecycleResult } from './ExtensionLifecycleResult';
import type { ExtensionCommandResult } from './ExtensionCommandResult';
import type { ExtensionInstallationProjection } from './ExtensionInstallationProjection';
import type { ExtensionRuntimeProjection } from './ExtensionRuntimeProjection';
import type { ExtensionRuntimeProjectionResult } from './ExtensionRuntimeProjectionResult';
import type { ExtensionStatusChanged } from './ExtensionStatusChanged';
import type { ExtensionUninstallResult } from './ExtensionUninstallResult';

export type PresentationRuntimeReadinessOwner = 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension';
export type PresentationRuntimeReadinessState = 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped';
export type PresentationRuntimeResourceState = 'pending' | 'ready' | 'missing' | 'degraded' | 'failed' | 'unknown';

/**
 * Presentation Plane 下行帧契约(kernel → client)。Desktop Surface 消费对话与状态投影，Unity Avatar Host 消费稳定 Avatar 语义；两者不共享实现对象。
 */
export interface PresentationDownstreamFrame {
  /**
   * 帧类型(discriminator)。reply/emotion/thought 属于表达流；expression/motion/lip_sync/parameter/idle 属于 Avatar 控制；其余为 Presentation 状态与生命周期消息。
   */
  kind:
    | 'reply'
    | 'emotion'
    | 'thought'
    | 'audio_play'
    | 'audio_transcript'
    | 'expression'
    | 'motion'
    | 'lip_sync'
    | 'parameter'
    | 'avatar_intent'
    | 'avatar_action_state'
    | 'presentation'
    | 'character_presentation_projection'
    | 'idle'
    | 'avatar_status'
    | 'runtime_readiness'
    | 'audio_status'
    | 'extension_install_preview'
    | 'extension_install_result'
    | 'extension_uninstall_result'
    | 'extension_lifecycle_result'
    | 'extension_command_result'
    | 'extension_runtime_projection_result'
    | 'extension_runtime_projection_changed'
    | 'extension_status_changed'
    | 'shutdown'
    | 'load_scene'
    | 'unload_scene'
    | 'ping';
  /**
   * 全链路追踪 ID，关联触发此帧的 perception、drive 或 cognitive activity；渲染边界必须保持原值。
   */
  trace_id?: string;
  /**
   * Unix 毫秒时间戳
   */
  timestamp: number;
  reply?: ReplyPayload;
  emotion?: EmotionPayload1;
  thought?: ThoughtPayload;
  audio_play?: AudioPlayPayload;
  audio_transcript?: AudioTranscriptPayload;
  expression?: AvatarExpressionPayload;
  motion?: AvatarMotionPayload;
  lip_sync?: AvatarLipSyncPayload;
  parameter?: AvatarParameterPayload;
  avatar_intent?: AvatarIntentPayload;
  avatar_action_state?: AvatarActionStatePayload;
  presentation?: AvatarPresentationPayload;
  character_presentation_projection?: CharacterPresentationProjectionPayload;
  avatar_status?: AvatarStatusPayload;
  runtime_readiness?: PresentationRuntimeReadinessCatalogPayload;
  audio_status?: AudioStatusPayload;
  extension_install_preview?: ExtensionInstallPreview;
  extension_install_result?: ExtensionInstallResult;
  extension_uninstall_result?: ExtensionUninstallResult;
  extension_lifecycle_result?: ExtensionLifecycleResult;
  extension_command_result?: ExtensionCommandResult;
  extension_runtime_projection_result?: ExtensionRuntimeProjectionResult;
  extension_runtime_projection_changed?: ExtensionRuntimeProjection;
  extension_status_changed?: ExtensionStatusChanged;
  load_scene?: LoadScenePayload;
  unload_scene?: UnloadScenePayload;
}
/**
 * kind=reply 时存在
 */
export interface ReplyPayload {
  /**
   * 回复完整文本。用于记忆、日志和不支持多消息的 shell 兜底。
   */
  text: string;
  /**
   * 回复投递消息列表。同一次 reply 可以拆成多条自然消息显示或发送。缺省时 shell 可按 text 作为单条消息处理。
   */
  messages?: PresentationReplyMessage[];
  emotion_snapshot?: EmotionPayload;
}
export interface PresentationReplyMessage {
  /**
   * 同一次回复内的投递顺序，从 0 开始。
   */
  sequence: number;
  /**
   * 消息内容类型。普通对话为 text；完整代码块可为 code。
   */
  content_type: 'text' | 'code';
  /**
   * 该条投递消息的正文。
   */
  text: string;
  /**
   * content_type=code 时的语言标识。
   */
  language?: string | null;
}
/**
 * 回复时的情绪快照（可选，ChannelReplyPayload.emotion_state 的结构化版）。emotion 帧已独立时通常不必带。
 */
export interface EmotionPayload {
  /**
   * 情绪语义 ID（happy / sad / angry / shy / thinking / calm / ...）。语义层跨 Avatar Host 一致，具体表情、动作和参数映射由 Avatar Package 的 emotion map 决定。
   */
  emotion_type: string;
  /**
   * 强度 0-1
   */
  intensity: number;
  /**
   * 触发原因(perception / drive / cognitive_activity / reflection / ...,观测用)
   */
  trigger?: string;
  /**
   * 表情过渡时间（毫秒，可选；Avatar Host 使用内部默认值）
   */
  blend_time_ms?: number;
}
/**
 * kind=emotion 时存在 —— 蓝图 §6.5 emotion 帧(独立于 reply,emotion_system 变化时可单独推送)
 */
export interface EmotionPayload1 {
  /**
   * 情绪语义 ID（happy / sad / angry / shy / thinking / calm / ...）。语义层跨 Avatar Host 一致，具体表情、动作和参数映射由 Avatar Package 的 emotion map 决定。
   */
  emotion_type: string;
  /**
   * 强度 0-1
   */
  intensity: number;
  /**
   * 触发原因(perception / drive / cognitive_activity / reflection / ...,观测用)
   */
  trigger?: string;
  /**
   * 表情过渡时间（毫秒，可选；Avatar Host 使用内部默认值）
   */
  blend_time_ms?: number;
}
/**
 * kind=thought 时存在 —— 蓝图 §6.5 thought 帧(Deliberate 期间推'思考中…'动效)
 */
export interface ThoughtPayload {
  /**
   * true=当前角色正在思考(显示动效);false=思考结束(隐藏动效)
   */
  active: boolean;
  /**
   * 可选思考提示(如'回忆中…'),shell 决定是否展示
   */
  hint?: string;
}
/**
 * kind=audio_play 时存在
 */
export interface AudioPlayPayload {
  /**
   * 音频唯一 ID(供观测 / 去重 / 取消)
   */
  audio_id: string;
  /**
   * 音频 URI(file:// 或 http(s)://),shell 自行 fetch。优先于 audio_data。
   */
  audio_uri?: string;
  /**
   * Base64 内联音频数据,仅 URI 不可用时用
   */
  audio_data?: string;
  /**
   * MIME 类型(默认 audio/wav)
   */
  mime_type?: string;
  /**
   * 时长(毫秒,可选;shell 可据此调整动画)
   */
  duration_ms?: number;
}
/**
 * kind=audio_transcript 时存在。Kernel 对 audio_input 的 ASR 结果回执，供 Control Center 展示用户语音文本。
 */
export interface AudioTranscriptPayload {
  /**
   * 对应 audio_input.audio_id。
   */
  audio_id: string;
  /**
   * ASR 结果状态。
   */
  status: 'success' | 'error';
  /**
   * 识别成功后的文本。
   */
  text?: string;
  /**
   * 识别失败或诊断说明。
   */
  message?: string;
}
/**
 * kind=expression 时存在；Avatar Host 将稳定语义 ID 映射到模型资源。
 */
export interface AvatarExpressionPayload {
  /**
   * 表情抽象 ID（happy / sad / ...）。Avatar Host 映射到具体资源（Live2D .exp3.json、Unity BlendShape、3D Animator 等）。
   */
  expression_id: string;
  /**
   * 过渡时间(毫秒)
   */
  blend_time_ms?: number;
  /**
   * 表情结束后是否自动回到中性
   */
  auto_reset?: boolean;
}
/**
 * kind=motion 时存在
 */
export interface AvatarMotionPayload {
  /**
   * 动作抽象 ID。支持命名空间(如 'cafe.sit_down',8.7+ 场景特定动作)。shell 按命名空间从注册的动作集中查找。
   */
  motion_id: string;
  /**
   * 是否循环
   */
  loop?: boolean;
  /**
   * 优先级(数字越大越优先;同优先级新覆盖旧)
   */
  priority?: number;
}
/**
 * kind=lip_sync 时存在
 */
export interface AvatarLipSyncPayload {
  /**
   * 嘴部开合幅度 0-1
   */
  amplitude: number;
  /**
   * 驱动源(audio=随音频包络,manual=直接指定值)
   */
  source?: 'audio' | 'manual';
}
/**
 * kind=parameter 时存在
 */
export interface AvatarParameterPayload {
  /**
   * 参数抽象 ID（blush_level / eye_openness / ...）。Avatar Host 映射到 Cubism parameter、shader property 或 3D blend shape。
   */
  param_id: string;
  /**
   * 参数值；有效范围由 Avatar Host 的模型 driver 约束
   */
  value: number;
  /**
   * 渐变时间(毫秒)
   */
  fade_ms?: number;
}
/**
 * kind=avatar_intent 时存在。稳定动作语义由 Avatar 本地 catalog 解析。
 */
export interface AvatarIntentPayload {
  /**
   * 稳定身体动作语义 ID。Shell 在模型 catalog 内解析其 expression、motion 或参数组合。
   */
  action_id: string;
  /**
   * 动作目标操作。保持动作不使用隐式翻转，避免重试和跨进程重复投递改变最终状态。
   */
  operation: 'trigger' | 'activate' | 'deactivate';
  /**
   * 意图发起者。只影响行为导演的优先级与审计，不携带模型实现细节。
   */
  source: 'user' | 'cognition' | 'system' | 'extension';
  /**
   * 可选优先级提示。行为导演根据来源与当前直接操控状态裁决最终效果。
   */
  priority?: number;
}
/**
 * kind=avatar_action_state 时存在。Kernel 向管理界面投影 Avatar 的权威动作状态。
 */
export interface AvatarActionStatePayload {
  /**
   * 引发本次变化的动作 ID。
   */
  action_id?: string;
  /**
   * 动作调度结果。
   */
  state?: 'inactive' | 'active' | 'running' | 'completed' | 'rejected';
  /**
   * Shell 当前全部已激活保持动作的权威快照。
   */
  active_action_ids: string[];
  /**
   * 拒绝原因或补充说明。
   */
  message?: string;
}
/**
 * kind=presentation 时存在。只控制身体的桌面呈现，不改变模型资产、人格或动作状态。
 */
export interface AvatarPresentationPayload {
  /**
   * 模型 catalog 声明的桌面驻留预设 ID，例如 bust / three-quarter / full-body；不得改变相机或模型比例。
   */
  placement_id?: string;
  /**
   * 完整身体透明表面的绝对显示倍率；Shell 通过表面尺寸实现，不在固定相机中放大模型。
   */
  display_scale?: number;
  /**
   * 为 true 时清除用户拖动位置，并按 placement_id 重新停靠到当前工作区。
   */
  reset_placement?: boolean;
}
/**
 * kind=character_presentation_projection 时存在。Kernel 向 Desktop、Presence 与 Avatar Host 广播统一呈现投影。
 */
export interface CharacterPresentationProjectionPayload {
  avatar_package_id: string;
  model_id: string;
  display_name: string;
  kind: 'live2d';
  backend: 'unity';
  host_kind: 'unity' | 'offline';
  avatar_state: 'pending' | 'starting' | 'ready' | 'degraded' | 'stopped';
  appearance: {
    placement_id?: string;
    display_scale: number;
  };
  lifecycle: {
    worker_window_state: 'isolated' | 'visible' | 'unknown';
    composition_surface_state: 'attached' | 'failed' | 'unknown';
    first_frame_presented: boolean;
    interaction_ready: boolean;
    ready: boolean;
    summary: string;
  };
}
/**
 * kind=avatar_status 时存在
 */
export interface AvatarStatusPayload {
  /**
   * kernel 视角下可观测的 shell 状态(对齐 KernelAvatarStatus):'unity' = 外部 Unity Avatar 已连接;'offline' = 没有外部 Shell，桌面端呈现等待或不可用状态，不再加载本地占位身体。
   */
  host_kind: 'unity' | 'offline';
  /**
   * shell 实例 ID(多 shell 并存时用)
   */
  host_id?: string;
}
/**
 * kind=runtime_readiness 时存在。Kernel 向 Desktop 广播统一 runtime/reconciler readiness 快照。
 */
export interface PresentationRuntimeReadinessCatalogPayload {
  updated_at: number;
  runtimes: PresentationRuntimeReadinessSnapshot[];
}
export interface PresentationRuntimeReadinessSnapshot {
  runtime_id: string;
  owner: PresentationRuntimeReadinessOwner;
  phase: string;
  state: PresentationRuntimeReadinessState;
  blocking: boolean;
  summary: string;
  details_ref?: string;
  duration_ms?: number;
  reconciler?: PresentationRuntimeReconcilerSnapshot;
}
export interface PresentationRuntimeReconcilerSnapshot {
  desired: string;
  actual: string;
  readiness: PresentationRuntimeResourceState;
  resources: PresentationRuntimeResourceSnapshot[];
}
export interface PresentationRuntimeResourceSnapshot {
  resource_id: string;
  resource_kind: string;
  desired_state: PresentationRuntimeResourceState;
  actual_state: PresentationRuntimeResourceState;
  readiness: PresentationRuntimeResourceState;
  summary: string;
  recovery_actions: string[];
}
/**
 * kind=audio_status 时存在。Control Center 用它展示 ASR/TTS 是否可用，不直接探测 Kernel 内部服务。
 */
export interface AudioStatusPayload {
  /**
   * Unix 毫秒时间戳
   */
  updated_at: number;
  tts: AudioCapabilityStatus;
  asr: AudioCapabilityStatus1;
}
/**
 * TTS 能力状态
 */
export interface AudioCapabilityStatus {
  /**
   * 该音频能力是否被系统配置启用。关闭时不执行预热或业务请求。
   */
  enabled: boolean;
  /**
   * 关闭原因或用户可见说明。
   */
  disabled_reason?: string;
  /**
   * 当前实际承载请求的 provider id
   */
  active_provider?: string;
  /**
   * 能力路线整体状态；degraded 表示已切换到 fallback。
   */
  route_state: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  /**
   * 按尝试顺序排列的 provider 状态
   */
  providers: AudioProviderStatus[];
}
export interface AudioProviderStatus {
  /**
   * 稳定 provider id
   */
  provider_id: string;
  /**
   * provider 在当前路线中的角色
   */
  role: 'primary' | 'fallback';
  /**
   * provider 的执行位置
   */
  execution: 'cloud' | 'local';
  /**
   * provider 当前可用性与熔断状态
   */
  status: 'ready' | 'degraded' | 'unavailable' | 'circuit_open' | 'unknown';
  /**
   * 不可用原因或补充说明
   */
  message?: string;
}
/**
 * ASR 能力状态
 */
export interface AudioCapabilityStatus1 {
  /**
   * 该音频能力是否被系统配置启用。关闭时不执行预热或业务请求。
   */
  enabled: boolean;
  /**
   * 关闭原因或用户可见说明。
   */
  disabled_reason?: string;
  /**
   * 当前实际承载请求的 provider id
   */
  active_provider?: string;
  /**
   * 能力路线整体状态；degraded 表示已切换到 fallback。
   */
  route_state: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  /**
   * 按尝试顺序排列的 provider 状态
   */
  providers: AudioProviderStatus[];
}

export interface LoadScenePayload {
  /**
   * 场景 ID(对应 Extension contributes.scenes.id)
   */
  scene_id: string;
  /**
   * 切换过渡时间(毫秒)
   */
  fade_ms?: number;
}
/**
 * kind=unload_scene 时存在
 */
export interface UnloadScenePayload {
  /**
   * 卸载过渡时间(毫秒)
   */
  fade_ms?: number;
}
