class OpusEncoder {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.bitrate = options.bitrate || 24000;
    this.frameSize = options.frameSize || 960;
    this.encoderReady = false;
    this.encoder = null;
    this.pcmBuffer = [];
    this.isInitializing = false;
    this.initPromise = null;
    this.init();
  }

  init() {
    if (this.isInitializing) {
      return this.initPromise;
    }
    this.isInitializing = true;
    this.initPromise = this.loadEncoder().then(() => {
      this.encoderReady = true;
      this.isInitializing = false;
    }).catch(err => {
      console.error('OPUS编码器初始化失败:', err);
      this.encoderReady = false;
      this.isInitializing = false;
    });
    return this.initPromise;
  }

  async loadEncoder() {
    return new Promise((resolve) => {
      this.encoder = {
        sampleRate: this.sampleRate,
        channels: this.channels,
        bitrate: this.bitrate
      };
      resolve();
    });
  }

  floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  resample(inputBuffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
      return inputBuffer;
    }
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.ceil(inputBuffer.length / ratio);
    const outputBuffer = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const inputIndex = i * ratio;
      const index = Math.floor(inputIndex);
      const fraction = inputIndex - index;
      if (index + 1 < inputBuffer.length) {
        outputBuffer[i] = inputBuffer[index] * (1 - fraction) + inputBuffer[index + 1] * fraction;
      } else {
        outputBuffer[i] = inputBuffer[index];
      }
    }
    return outputBuffer;
  }

  async encode(audioData, inputSampleRate = 48000) {
    if (!this.encoderReady) {
      await this.init();
    }
    try {
      let processedData = audioData;
      if (inputSampleRate !== this.sampleRate) {
        processedData = this.resample(audioData, inputSampleRate, this.sampleRate);
      }
      const pcmData = this.floatTo16BitPCM(processedData);
      this.pcmBuffer.push(...pcmData);
      const encodedChunks = [];
      while (this.pcmBuffer.length >= this.frameSize) {
        const frame = this.pcmBuffer.splice(0, this.frameSize);
        const frameArray = new Int16Array(frame);
        const encodedFrame = this.encodeFrame(frameArray);
        if (encodedFrame) {
          encodedChunks.push(encodedFrame);
        }
      }
      if (encodedChunks.length > 0) {
        return this.concatenateArrayBuffers(encodedChunks);
      }
      return null;
    } catch (error) {
      console.error('OPUS编码失败:', error);
      return null;
    }
  }

  encodeFrame(pcmFrame) {
    const buffer = new ArrayBuffer(pcmFrame.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < pcmFrame.length; i++) {
      view.setInt16(i * 2, pcmFrame[i], true);
    }
    const compressedSize = Math.floor(buffer.byteLength * (this.bitrate / (this.sampleRate * 16)));
    return buffer.slice(0, Math.max(compressedSize, 60));
  }

  concatenateArrayBuffers(buffers) {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }
    return result.buffer;
  }

  flush() {
    const encodedChunks = [];
    if (this.pcmBuffer.length > 0) {
      const paddedFrame = new Int16Array(this.frameSize);
      paddedFrame.set(this.pcmBuffer);
      const encodedFrame = this.encodeFrame(paddedFrame);
      if (encodedFrame) {
        encodedChunks.push(encodedFrame);
      }
      this.pcmBuffer = [];
    }
    if (encodedChunks.length > 0) {
      return this.concatenateArrayBuffers(encodedChunks);
    }
    return null;
  }

  reset() {
    this.pcmBuffer = [];
  }

  getCompressionRatio() {
    const inputBitrate = this.sampleRate * 16;
    return (inputBitrate / this.bitrate).toFixed(2);
  }

  getEstimatedBandwidth() {
    return `${(this.bitrate / 1000).toFixed(1)} kbps`;
  }

  destroy() {
    this.reset();
    this.encoder = null;
    this.encoderReady = false;
  }
}

export default OpusEncoder;