/**
 * AudioWorklet：降采样至 16kHz 单声道，按块输出 Int16 PCM
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.targetRate = opts.targetSampleRate || 16000;
    this.chunkDurationMs = opts.chunkDurationMs || 800;
    this.inputRate = sampleRate;
    this.ratio = this.inputRate / this.targetRate;
    this.buffer = [];
    this.samplesPerChunk = Math.floor((this.targetRate * this.chunkDurationMs) / 1000);
    this.readIndex = 0;
    this.inputLength = 0;
    this.inputBuffer = new Float32Array(0);
  }

  downsample(input) {
    const newLen = this.inputLength + input.length;
    const merged = new Float32Array(newLen);
    merged.set(this.inputBuffer, 0);
    merged.set(input, this.inputLength);
    this.inputBuffer = merged;
    this.inputLength = newLen;

    const output = [];
    while (this.readIndex + this.ratio < this.inputLength) {
      const idx = Math.floor(this.readIndex);
      const frac = this.readIndex - idx;
      const s0 = this.inputBuffer[idx] || 0;
      const s1 = this.inputBuffer[idx + 1] || s0;
      output.push(s0 + frac * (s1 - s0));
      this.readIndex += this.ratio;
    }

    const consumed = Math.floor(this.readIndex);
    this.inputBuffer = this.inputBuffer.slice(consumed);
    this.inputLength = this.inputBuffer.length;
    this.readIndex -= consumed;

    return output;
  }

  floatToInt16(samples) {
    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input && output) {
      for (let c = 0; c < input.length && c < output.length; c++) {
        if (output[c] && input[c]) output[c].set(input[c]);
      }
    }
    if (!input || !input[0]) return true;

    const mono = input[0];
    const downsampled = this.downsample(mono);
    this.buffer.push(...downsampled);

    while (this.buffer.length >= this.samplesPerChunk) {
      const chunk = this.buffer.splice(0, this.samplesPerChunk);
      const pcm = this.floatToInt16(chunk);
      this.port.postMessage(
        { type: 'pcm-chunk', buffer: pcm.buffer },
        [pcm.buffer]
      );
    }

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
