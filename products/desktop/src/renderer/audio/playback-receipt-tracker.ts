export interface PlaybackSegment {
  readonly output_id?: string;
  readonly duration_ms?: number;
  readonly segment_index?: number;
  readonly segment_count?: number;
}

export interface PlaybackCompletion {
  readonly receiptKind: 'playback_progress' | 'playback_completed';
  readonly heardThroughMs: number;
  readonly durationMs?: number;
}

/** 将逐段播放器反馈归并为 Delivery owner 使用的单调已听范围。 */
export class PlaybackReceiptTracker {
  private readonly heardThroughByOutput = new Map<string, number>();

  public complete(payload: PlaybackSegment, segmentHeardThroughMs: number): PlaybackCompletion {
    const outputId = payload.output_id;
    const previous = outputId ? this.heardThroughByOutput.get(outputId) ?? 0 : 0;
    const segmentDuration = Math.max(0, Math.round(segmentHeardThroughMs || payload.duration_ms || 0));
    const heardThroughMs = previous + segmentDuration;
    const segmentIndex = payload.segment_index ?? 0;
    const segmentCount = payload.segment_count ?? 1;
    const completed = segmentCount > 0 && segmentIndex === segmentCount - 1;
    if (outputId) {
      if (completed) this.heardThroughByOutput.delete(outputId);
      else this.heardThroughByOutput.set(outputId, heardThroughMs);
    }
    return {
      receiptKind: completed ? 'playback_completed' : 'playback_progress',
      heardThroughMs,
      ...(completed ? { durationMs: heardThroughMs } : {}),
    };
  }

  public reset(): void {
    this.heardThroughByOutput.clear();
  }
}
