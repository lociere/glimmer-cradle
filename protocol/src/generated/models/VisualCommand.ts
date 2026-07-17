/* 自动生成 — 从 VisualCommand.schema.json 生成，勿手动修改 */

/**
 * 提线木偶视觉指令契约——唯一真相源。内核发出的视觉/音频同步指令，由渲染器插件（VTube Studio / Unity）执行。禁止平台私有字段。
 */
export interface VisualCommand {
  /**
   * 全链路追踪 ID（关联触发此视觉指令的 ActionCommand.trace_id）
   */
  trace_id: string;
  /**
   * 指令类型：set_expression=设置表情；play_motion=播放动作；lip_sync=口型同步；set_parameter=设置模型参数；play_audio=播放音频；idle=回到待机
   */
  command_type: 'set_expression' | 'play_motion' | 'lip_sync' | 'set_parameter' | 'play_audio' | 'idle';
  /**
   * Unix 毫秒时间戳
   */
  timestamp: number;
  expression?: ExpressionPayload;
  motion?: MotionPayload;
  lip_sync?: LipSyncPayload;
  parameter?: ParameterPayload;
  audio?: AudioPayload;
  emotion_state?: VisualEmotionSnapshot;
}
export interface ExpressionPayload {
  /**
   * 表情 ID（对应 Live2D Expression / VTS Expression）
   */
  expression_id: string;
  /**
   * 表情过渡时间（毫秒）
   */
  blend_time_ms?: number;
  /**
   * 表情结束后是否自动回到中性
   */
  auto_reset?: boolean;
}
export interface MotionPayload {
  /**
   * 动作 ID（对应 Live2D Motion / Unity Animation）
   */
  motion_id: string;
  /**
   * 动作分组（如 idle / greeting / reaction）
   */
  motion_group?: string | null;
  /**
   * 是否循环播放
   */
  loop?: boolean;
  /**
   * 动作优先级：0=idle, 1=normal, 2=force, 3=override
   */
  priority?: number;
}
export interface LipSyncPayload {
  /**
   * 关联的音频资源引用（与 AudioPayload.audio_id 对应）
   */
  audio_ref?: string | null;
  /**
   * 预计算的口型帧序列（可选，若无则由渲染器实时分析音频）
   */
  viseme_data?: VisemeFrame[];
  /**
   * 是否启用口型同步
   */
  enabled?: boolean;
}
export interface VisemeFrame {
  /**
   * 相对于音频起始的毫秒偏移
   */
  time_ms: number;
  /**
   * 口型标识（如 sil/aa/oh/ee 等）
   */
  viseme: string;
  /**
   * 口型权重 0-1
   */
  weight?: number;
}
export interface ParameterPayload {
  /**
   * 参数值列表
   */
  parameters: ParameterValue[];
  /**
   * 参数过渡时间（毫秒）
   */
  blend_time_ms?: number;
}
export interface ParameterValue {
  /**
   * 参数名称（如 ParamMouthOpenY / ParamEyeLOpen）
   */
  name: string;
  /**
   * 参数值
   */
  value: number;
}
export interface AudioPayload {
  /**
   * 音频资源唯一 ID
   */
  audio_id: string;
  /**
   * Base64 编码的音频数据（PCM/WAV/MP3）
   */
  audio_data?: string | null;
  /**
   * 音频文件 URI（与 audio_data 二选一）
   */
  audio_uri?: string | null;
  /**
   * 音频 MIME 类型（如 audio/wav）
   */
  mime_type?: string;
  /**
   * 音频时长（毫秒）
   */
  duration_ms?: number;
}
export interface VisualEmotionSnapshot {
  emotion_type?: string;
  intensity?: number;
  trigger?: string | null;
  [k: string]: unknown;
}
