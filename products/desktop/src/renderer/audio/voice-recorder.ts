export interface VoiceRecordingResult {
  audioData: string;
  mimeType: string;
  durationMs: number;
  sampleRate: number;
}

/**
 * Control Center 语音输入录制器。
 *
 * renderer 只负责采集麦克风并编码为 WAV；ASR、落盘和感知注入统一交给 Kernel。
 * 这样桌面 UI 不直接绑定 FunASR，也不会绕开 PresentationFrame 契约。
 */
export class VoiceRecorder {
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private highPass: BiquadFilterNode | null = null;
  private lowPass: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private sampleRate = 16000;

  async start(): Promise<void> {
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextCtor: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextCtor();
    this.sampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.highPass = this.audioContext.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = 85;
    this.highPass.Q.value = 0.7;

    this.lowPass = this.audioContext.createBiquadFilter();
    this.lowPass.type = 'lowpass';
    this.lowPass.frequency.value = 7600;
    this.lowPass.Q.value = 0.7;

    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = -48;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    // ScriptProcessorNode 仍是 Electron 当前稳定可用的轻量方案。
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
    };

    this.source.connect(this.highPass);
    this.highPass.connect(this.lowPass);
    this.lowPass.connect(this.compressor);
    this.compressor.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.startedAt = Date.now();
  }

  async stop(): Promise<VoiceRecordingResult> {
    if (!this.stream || !this.audioContext) {
      throw new Error('录音尚未开始');
    }

    const durationMs = Math.max(1, Date.now() - this.startedAt);
    this.disconnect();

    const pcm = enhanceSpeechPcm(mergeChunks(this.chunks), this.sampleRate);
    this.chunks = [];
    const wav = encodeWav(pcm, this.sampleRate);
    await this.audioContext.close();
    this.audioContext = null;

    return {
      audioData: arrayBufferToBase64(wav),
      mimeType: 'audio/wav',
      durationMs,
      sampleRate: this.sampleRate,
    };
  }

  cancel(): void {
    this.disconnect();
    this.chunks = [];
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private disconnect(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.highPass) {
      this.highPass.disconnect();
      this.highPass = null;
    }
    if (this.lowPass) {
      this.lowPass.disconnect();
      this.lowPass = null;
    }
    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function enhanceSpeechPcm(samples: Float32Array, sampleRate: number): Float32Array {
  if (samples.length === 0) return samples;

  const frameSize = Math.max(160, Math.floor(sampleRate * 0.02));
  const rmsValues: number[] = [];
  let sum = 0;

  for (const sample of samples) {
    sum += sample;
  }

  const dcOffset = sum / samples.length;
  const centered = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    centered[i] = samples[i] - dcOffset;
  }

  for (let offset = 0; offset < centered.length; offset += frameSize) {
    let energy = 0;
    const end = Math.min(centered.length, offset + frameSize);
    for (let i = offset; i < end; i += 1) {
      energy += centered[i] * centered[i];
    }
    rmsValues.push(Math.sqrt(energy / Math.max(1, end - offset)));
  }

  const sortedRms = [...rmsValues].sort((a, b) => a - b);
  const noiseFloor = sortedRms[Math.floor(sortedRms.length * 0.2)] ?? 0;
  const gateThreshold = Math.max(0.004, noiseFloor * 2.4);
  const output = new Float32Array(centered.length);
  let smoothedGain = 1;

  for (let frame = 0; frame < rmsValues.length; frame += 1) {
    const targetGain = rmsValues[frame] < gateThreshold ? 0.18 : 1;
    const start = frame * frameSize;
    const end = Math.min(centered.length, start + frameSize);

    for (let i = start; i < end; i += 1) {
      smoothedGain = smoothedGain * 0.92 + targetGain * 0.08;
      output[i] = centered[i] * smoothedGain;
    }
  }

  let peak = 0;
  for (const sample of output) {
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak > 0.01 && peak < 0.85) {
    const gain = Math.min(3, 0.85 / peak);
    for (let i = 0; i < output.length; i += 1) {
      output[i] *= gain;
    }
  }

  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
