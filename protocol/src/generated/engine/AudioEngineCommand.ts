/* 自动生成 — 从 AudioEngineCommand.schema.json 生成，勿手动修改 */

/**
 * Kernel 与 Audio Engine 之间的单请求命令帧。
 */
export interface AudioEngineCommand {
  id: string;
  command: 'health' | 'host.shutdown' | 'asr.warmup' | 'tts.warmup' | 'asr.recognize' | 'tts.synthesize';
  payload: {
    [k: string]: unknown;
  };
}
