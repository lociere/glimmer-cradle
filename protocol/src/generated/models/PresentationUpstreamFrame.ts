/* 自动生成 — 从 PresentationUpstreamFrame.schema.json 生成，勿手动修改 */

import type { ExtensionInstallCommitRequest } from './ExtensionInstallCommitRequest';
import type { ExtensionInstallPrepareRequest } from './ExtensionInstallPrepareRequest';
import type { ExtensionLifecycleRequest } from './ExtensionLifecycleRequest';
import type { ExtensionCommandRequest } from './ExtensionCommandRequest';
import type { ExtensionRuntimeProjection } from './ExtensionRuntimeProjection';
import type { ExtensionRuntimeProjectionRequest } from './ExtensionRuntimeProjectionRequest';
import type { ExtensionUninstallRequest } from './ExtensionUninstallRequest';

/**
 * Presentation Plane 上行帧契约(client → kernel)。Unity Avatar Host 通过 host_hello 宣告实现与能力；Desktop Surface 通过 chat_input、audio_input 和 Avatar 请求提交用户交互。
 */
export interface PresentationUpstreamFrame {
  /**
   * 上行帧类型(discriminator)。host_hello 握手 + 能力宣告;host_ready 表示完成初始化;chat_input 用户直接输入(对话);perception 场景内交互发送(8.7+);scene_loaded/unloaded 场景生命周期回执;heartbeat/pong 心跳;animation_complete 动画结束反馈;error 错误上报。
   */
  kind:
    | 'host_hello'
    | 'host_ready'
    | 'chat_input'
    | 'audio_input'
    | 'avatar_presentation'
    | 'avatar_intent'
    | 'avatar_action_state'
    | 'extension_install_prepare'
    | 'extension_install_commit'
    | 'extension_install_cancel'
    | 'extension_uninstall_request'
    | 'extension_lifecycle_request'
    | 'extension_command_request'
    | 'extension_runtime_projection_request'
    | 'shutdown_request'
    | 'perception'
    | 'scene_loaded'
    | 'scene_unloaded'
    | 'heartbeat'
    | 'pong'
    | 'animation_complete'
    | 'error';
  /**
   * 全链路追踪 ID。chat_input / perception 等用户触发帧应携带，基础设施帧可省略。
   */
  trace_id?: string;
  /**
   * Unix 毫秒时间戳
   */
  timestamp: number;
  host_hello?: AvatarHostHelloPayload;
  host_ready?: AvatarHostReadyPayload;
  chat_input?: ChatInputPayload;
  audio_input?: AudioInputPayload;
  avatar_presentation?: AvatarPresentationRequest;
  avatar_intent?: AvatarIntentRequest;
  avatar_action_state?: AvatarActionStateReportPayload;
  extension_install_prepare?: ExtensionInstallPrepareRequest;
  extension_install_commit?: ExtensionInstallCommitRequest;
  extension_install_cancel?: {
    request_id: string;
    transaction_id: string;
  };
  extension_uninstall_request?: ExtensionUninstallRequest;
  extension_lifecycle_request?: ExtensionLifecycleRequest;
  extension_command_request?: ExtensionCommandRequest;
  extension_runtime_projection_request?: ExtensionRuntimeProjectionRequest;
  shutdown_request?: ShutdownRequestPayload;
  perception?: PerceptionInputPayload;
  scene_loaded?: SceneLifecyclePayload;
  scene_unloaded?: SceneLifecyclePayload1;
  animation_complete?: AnimationCompletePayload;
  error?: AvatarHostErrorPayload;
}
/**
 * kind=host_hello 时存在
 */
export interface AvatarHostHelloPayload {
  /**
   * 当前 Avatar Host 实现类型。
   */
  host_kind: 'unity';
  /**
   * Avatar Host 实例唯一 ID。
   */
  host_id?: string;
  /**
   * Avatar Host 实现版本。
   */
  host_version?: string;
  /**
   * Avatar Host 声明能消费的下行帧类型和可加载贡献；Kernel 不发送未声明能力。
   */
  capabilities?: (
    | 'expression'
    | 'motion'
    | 'avatar_intent'
    | 'lip_sync'
    | 'parameter'
    | 'audio_play'
    | 'load_scene'
    | 'load_extension_avatar_model'
    | 'load_extension_motion'
    | 'load_extension_scene'
    | 'load_extension_soundscape'
  )[];
  /**
   * 当前激活的 Avatar Model ID。
   */
  model_id?: string;
  /**
   * 当前激活的身体资产包 ID。用于区分角色身体包与底层模型 ID。
   */
  avatar_package_id?: string;
}
/**
 * kind=host_ready 时存在。Unity Avatar Host 只在 Avatar Package、Composition Surface、首帧和交互均就绪后上报。
 */
export interface AvatarHostReadyPayload {
  host_id?: string;
  model_id?: string;
  avatar_package_id?: string;
  /**
   * Unity worker window 是否已经退居后台工作容器，避免启动闪窗。
   */
  worker_window_state: 'isolated' | 'visible' | 'unknown';
  /**
   * 正式透明合成表面是否已经附着。
   */
  composition_surface_state: 'attached' | 'failed' | 'unknown';
  /**
   * 正式身体的首帧是否已经实际呈现到桌面。
   */
  first_frame_presented: boolean;
  /**
   * 模型 driver、输入 hull 与交互控制是否已经可用。
   */
  interaction_ready: boolean;
  /**
   * 面向运行时和调试面的简要状态总结。
   */
  summary?: string;
}
/**
 * kind=chat_input 时存在
 */
export interface ChatInputPayload {
  /**
   * 用户键盘输入的文本
   */
  text: string;
  /**
   * 可选子来源标记(避免来自不同 UI 路径混淆)
   */
  source_suffix?: string;
}
/**
 * kind=audio_input 时存在。桌面端录音输入，Kernel 负责落盘、ASR 与后续感知注入。
 */
export interface AudioInputPayload {
  /**
   * 本次录音的唯一 ID，供去重、日志和 transcript 对齐。
   */
  audio_id: string;
  /**
   * Base64 编码音频数据。Control Center 当前发送 WAV，避免 ASR 依赖浏览器私有编码。
   */
  audio_data: string;
  /**
   * 音频 MIME 类型，默认 audio/wav。
   */
  mime_type: string;
  /**
   * 录音时长，毫秒。
   */
  duration_ms?: number;
  /**
   * 采样率，供诊断和后续重采样策略使用。
   */
  sample_rate?: number;
}
/**
 * kind=avatar_presentation 时存在。Control Center 请求 Kernel 更新正式 Avatar 的呈现状态。
 */
export interface AvatarPresentationRequest {
  /**
   * 用户请求采用的桌面驻留预设 ID。预设只决定完整透明表面在工作区内的可见比例与停靠位置。
   */
  placement_id?: string;
  /**
   * 用户请求的绝对显示倍率。
   */
  display_scale?: number;
  /**
   * 请求清除保存的窗口位置并回到预设停靠位置。
   */
  reset_placement?: boolean;
}
/**
 * kind=avatar_intent 时存在。Control Center 提交模型清单已声明的稳定身体动作意图。
 */
export interface AvatarIntentRequest {
  /**
   * 模型动作清单声明的稳定语义 ID，如 expression.shy 或 pose.hand-raised。
   */
  action_id: string;
  /**
   * 动作目标操作。一次性动作使用 trigger；可保持动作必须明确 activate 或 deactivate。
   */
  operation: 'trigger' | 'activate' | 'deactivate';
  /**
   * 用户显式请求的优先级提示；Shell 的行为导演仍保留最终仲裁权。
   */
  priority?: number;
}
/**
 * kind=avatar_action_state 时存在。Avatar 回报动作调度器的权威状态快照。
 */
export interface AvatarActionStateReportPayload {
  /**
   * 引发本次变化的动作 ID；完整快照可省略。
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
   * 拒绝原因或面向用户的补充说明。
   */
  message?: string;
}

export interface ShutdownRequestPayload {
  /**
   * 停机请求来源。仅允许受管产品控制表面发起全局停机。
   */
  requested_by: 'control-surface';
  /**
   * 人类可读的停机原因，供生命周期日志记录。
   */
  reason?: string;
}
/**
 * kind=perception 时存在(场景内交互 / scene 对象触发等通用感知通道)
 */
export interface PerceptionInputPayload {
  /**
   * 感知描述文本(如 '用户翻开了桌上的书')
   */
  text: string;
  /**
   * 默认 direct(场景内主动交互);ambient 留给被动环境感知
   */
  address_mode?: 'direct' | 'ambient';
  /**
   * 触发来源的场景 ID(8.7+ scene extension 用)
   */
  scene_id?: string;
  /**
   * 场景内触发对象 ID(8.7+ scene interactions 用)
   */
  object_id?: string;
  /**
   * 可选辅助信息(对象坐标 / 持续时间 / 其他场景上下文)
   */
  metadata?: {
    [k: string]: unknown;
  };
}
/**
 * kind=scene_loaded 时存在
 */
export interface SceneLifecyclePayload {
  /**
   * 场景 ID
   */
  scene_id: string;
  /**
   * 场景加载完成时,shell 向 kernel 上报场景的 narrative,kernel 更新 narrative context
   */
  narrative?: {
    /**
     * 场景的叙事摘要(注入 Deliberate prompt,当前角色知道自己在哪)
     */
    scene_summary?: string;
    /**
     * 氛围描述(calm / intimate / energetic / ...)
     */
    atmosphere?: string;
  };
}
/**
 * kind=scene_unloaded 时存在
 */
export interface SceneLifecyclePayload1 {
  /**
   * 场景 ID
   */
  scene_id: string;
  /**
   * 场景加载完成时,shell 向 kernel 上报场景的 narrative,kernel 更新 narrative context
   */
  narrative?: {
    /**
     * 场景的叙事摘要(注入 Deliberate prompt,当前角色知道自己在哪)
     */
    scene_summary?: string;
    /**
     * 氛围描述(calm / intimate / energetic / ...)
     */
    atmosphere?: string;
  };
}
/**
 * kind=animation_complete 时存在
 */
export interface AnimationCompletePayload {
  /**
   * 完成的动画 ID(对应 motion_id / expression_id)
   */
  animation_id: string;
}
/**
 * kind=error 时存在
 */
export interface AvatarHostErrorPayload {
  /**
   * 错误码(shell 端定义,如 model_load_failed / scene_not_found)
   */
  code: string;
  /**
   * 人类可读错误描述
   */
  message: string;
  /**
   * 可选附加详情
   */
  details?: {
    [k: string]: unknown;
  };
}
