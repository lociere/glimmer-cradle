import { AudioEnvelopePlayer } from './audio-envelope-player';

interface AudioPlayPayload {
  trace_id: string;
  audio_id: string;
  audio_uri?: string;
  audio_data?: string;
  mime_type?: string;
  duration_ms?: number;
}

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
  private playing = false;

  constructor() {
    this.player = new AudioEnvelopePlayer({
      onEnvelope: (envelope) => {
        window.dispatchEvent(new CustomEvent('audio:envelope', {
          detail: { envelope },
        }));
      },
      onError: (error) => {
        console.warn('[audio-playback] failed to play audio', error);
        this.playing = false;
        queueMicrotask(() => void this.playNext());
      },
      onEnded: () => {
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
      return;
    }
    if (this.activeTraceId && this.activeTraceId !== payload.trace_id) {
      this.queue.length = 0;
      this.playing = false;
      this.player.stop();
    }
    this.activeTraceId = payload.trace_id;
    this.queue.push(payload);
    await this.playNext();
  }

  dispose(): void {
    this.queue.length = 0;
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
    await this.player.play(source);
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
