export interface AudioEnvelopePlayerOptions {
  smoothing?: number;
  gain?: number;
  onEnvelope: (envelope: number) => void;
  onEnded?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * 播放音频并提取归一化响度包络。
 *
 * 播放属于 Desktop 音频适配层；包络只是可选输出，可由 Avatar 桥接消费，
 * 因而这里不依赖任何具体形象运行时。
 */
export class AudioEnvelopePlayer {
  private readonly options: Required<Pick<AudioEnvelopePlayerOptions, 'smoothing' | 'gain' | 'onEnvelope'>>
    & Pick<AudioEnvelopePlayerOptions, 'onEnded' | 'onError'>;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private element: HTMLAudioElement | null = null;
  private frameId: number | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private smoothedEnvelope = 0;
  private disposed = false;

  constructor(options: AudioEnvelopePlayerOptions) {
    this.options = {
      smoothing: options.smoothing ?? 0.6,
      gain: options.gain ?? 4,
      onEnvelope: options.onEnvelope,
      onEnded: options.onEnded,
      onError: options.onError,
    };
  }

  async play(url: string): Promise<void> {
    if (this.disposed) return;
    this.stop();

    try {
      const context = this.ensureContext();
      const element = new Audio();
      if (/^https?:\/\//i.test(url)) element.crossOrigin = 'anonymous';
      element.src = url;
      element.onended = () => this.handleEnded();
      element.onerror = () => this.handleError(this.describeMediaError(element.error));
      this.element = element;

      this.source = context.createMediaElementSource(element);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
      this.analyser.connect(context.destination);
      this.samples = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

      if (context.state === 'suspended') await context.resume();
      await element.play();
      this.startSampling();
    } catch (error) {
      this.options.onError?.(error);
      this.stop();
    }
  }

  stop(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    if (this.element) {
      this.element.onended = null;
      this.element.onerror = null;
      try { this.element.pause(); } catch { /* 浏览器可能已自行结束播放。 */ }
      this.element.removeAttribute('src');
    }
    try { this.source?.disconnect(); } catch { /* 音频节点可能已断开。 */ }
    try { this.analyser?.disconnect(); } catch { /* 音频节点可能已断开。 */ }
    this.element = null;
    this.source = null;
    this.analyser = null;
    this.samples = null;
    this.smoothedEnvelope = 0;
    this.options.onEnvelope(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.context) void this.context.close();
    this.context = null;
  }

  private ensureContext(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  private startSampling(): void {
    const sample = (): void => {
      if (this.disposed || !this.analyser || !this.samples) return;
      this.analyser.getByteTimeDomainData(this.samples);
      let squareSum = 0;
      for (const sampleValue of this.samples) {
        const normalized = (sampleValue - 128) / 128;
        squareSum += normalized * normalized;
      }
      const rawEnvelope = Math.min(1, Math.sqrt(squareSum / this.samples.length) * this.options.gain);
      this.smoothedEnvelope = this.smoothedEnvelope * this.options.smoothing
        + rawEnvelope * (1 - this.options.smoothing);
      this.options.onEnvelope(this.smoothedEnvelope);
      this.frameId = requestAnimationFrame(sample);
    };
    this.frameId = requestAnimationFrame(sample);
  }

  private handleEnded(): void {
    this.stop();
    this.options.onEnded?.();
  }

  private handleError(error: unknown): void {
    this.options.onError?.(error);
    this.stop();
  }

  private describeMediaError(error: MediaError | null): Error {
    if (!error) return new Error('HTMLAudioElement 播放失败，未返回 MediaError');
    return new Error(`HTMLAudioElement 播放失败 (code=${error.code}): ${error.message || 'unknown'}`);
  }
}
