export interface PlayoutProgress {
  readonly heard_through_ms: number;
  readonly duration_ms?: number;
}

export function validatePlayoutProgress(
  currentHeardThroughMs: number,
  progress: PlayoutProgress,
): void {
  if (!Number.isSafeInteger(progress.heard_through_ms) || progress.heard_through_ms < 0) {
    throw new TypeError('heard_through_ms 必须是非负安全整数');
  }
  if (progress.heard_through_ms < currentHeardThroughMs) {
    throw new Error('播放进度不得倒退');
  }
  if (progress.duration_ms !== undefined) {
    if (!Number.isSafeInteger(progress.duration_ms) || progress.duration_ms < 0) {
      throw new TypeError('duration_ms 必须是非负安全整数');
    }
    if (progress.heard_through_ms > progress.duration_ms) {
      throw new Error('已听范围不得超过输出时长');
    }
  }
}

