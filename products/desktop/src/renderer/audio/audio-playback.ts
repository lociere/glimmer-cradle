import { AudioEnvelopePlayer } from './audio-envelope-player';
import { PlaybackReceiptTracker } from './playback-receipt-tracker';

export interface AudioPlayPayload {
  trace_id: string;
  audio_id: string;
  audio_uri?: string;
  audio_data?: string;
  mime_type?: string;
  duration_ms?: number;
  output_id?: string;
  destination_id?: string;
  authority_epoch?: string;
  generation?: number;
  segment_index?: number;
  segment_count?: number;
}

interface DeliveryReceiptPayload {
  output_id: string;
  destination_id: string;
  authority_epoch: string;
  generation: number;
  receipt_id: string;
  receipt_kind: 'delivered' | 'playback_started' | 'playback_progress' | 'playback_completed' | 'failed' | 'unknown';
  heard_through_ms?: number;
  duration_ms?: number;
  reason?: string;
  received_at: string;
}

type DeliveryReceiptReporter = (receipt: DeliveryReceiptPayload) => Promise<void>;

/**
 * Renderer 侧统一音频播放入口。
 *
 * Kernel 只下发 audio_play 帧；Electron Main 负责选择唯一播放 Surface，
 * renderer 不得各自竞争播放同一帧。
 */
export class AudioPlaybackController {
  private readonly player: AudioEnvelopePlayer;
  private readonly queue: AudioPlayPayload[] = [];
  private activeTraceId: string | null = null;
  private activePayload: AudioPlayPayload | null = null;
  private readonly receiptTracker = new PlaybackReceiptTracker();
  private playing = false;

  constructor(private readonly reportReceipt?: DeliveryReceiptReporter) {
    this.player = new AudioEnvelopePlayer({
      onEnvelope: (envelope) => {
        window.dispatchEvent(new CustomEvent('audio:envelope', {
          detail: { envelope },
        }));
      },
      onStarted: () => {
        if (this.activePayload) this.report(this.activePayload, 'playback_started');
      },
      onError: (error) => {
        console.warn('[audio-playback] failed to play audio', error);
        if (this.activePayload) {
          this.report(this.activePayload, 'failed', { reason: this.describeError(error) });
        }
        this.activePayload = null;
        this.playing = false;
        queueMicrotask(() => void this.playNext());
      },
      onEnded: (timing) => {
        const payload = this.activePayload;
        this.activePayload = null;
        if (payload) this.reportCompletion(payload, timing.heardThroughMs);
        this.playing = false;
        void this.playNext();
      },
    });
  }

  async play(payload: AudioPlayPayload): Promise<void> {
    if (!this.resolveSource(payload)) {
      console.warn('[audio-playback] audio_play without playable source', {
        audio_id: payload.audio_id,
        trace_id: payload.trace_id,
      });
      this.report(payload, 'failed', { reason: 'audio_play_without_source' });
      return;
    }
    if (this.activeTraceId && this.activeTraceId !== payload.trace_id) {
      this.queue.length = 0;
      this.playing = false;
      this.activePayload = null;
      this.receiptTracker.reset();
      this.player.stop();
    }
    this.activeTraceId = payload.trace_id;
    this.queue.push(payload);
    await this.playNext();
  }

  dispose(): void {
    this.queue.length = 0;
    this.activePayload = null;
    this.receiptTracker.reset();
    this.player.dispose();
  }

  private async playNext(): Promise<void> {
    if (this.playing) return;
    const payload = this.queue.shift();
    if (!payload) {
      this.activeTraceId = null;
      return;
    }
    const source = this.resolveSource(payload);
    if (!source) {
      await this.playNext();
      return;
    }
    this.playing = true;
    this.activePayload = payload;
    await this.player.play(source);
  }

  private reportCompletion(payload: AudioPlayPayload, segmentHeardThroughMs: number): void {
    const completion = this.receiptTracker.complete(payload, segmentHeardThroughMs);
    this.report(payload, completion.receiptKind, {
      heard_through_ms: completion.heardThroughMs,
      ...(completion.durationMs === undefined ? {} : { duration_ms: completion.durationMs }),
    });
  }

  private report(
    payload: AudioPlayPayload,
    receiptKind: DeliveryReceiptPayload['receipt_kind'],
    details: Partial<Pick<DeliveryReceiptPayload, 'heard_through_ms' | 'duration_ms' | 'reason'>> = {},
  ): void {
    if (
      !this.reportReceipt
      || !payload.output_id
      || !payload.destination_id
      || !payload.authority_epoch
      || typeof payload.generation !== 'number'
      || !Number.isSafeInteger(payload.generation)
      || payload.generation <= 0
    ) return;
    const progress = details.heard_through_ms ?? 0;
    const receiptId = [
      'desktop', payload.output_id, payload.generation, payload.audio_id, receiptKind, progress,
    ].join(':');
    void this.reportReceipt({
      output_id: payload.output_id,
      destination_id: payload.destination_id,
      authority_epoch: payload.authority_epoch,
      generation: payload.generation,
      receipt_id: receiptId,
      receipt_kind: receiptKind,
      received_at: new Date().toISOString(),
      ...details,
    }).catch((error) => {
      console.warn('[audio-playback] failed to report delivery receipt', error);
    });
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private resolveSource(payload: AudioPlayPayload): string | null {
    if (payload.audio_data) {
      const mimeType = payload.mime_type || 'audio/wav';
      return `data:${mimeType};base64,${payload.audio_data}`;
    }

    if (payload.audio_uri) {
      return payload.audio_uri;
    }

    return null;
  }
}
