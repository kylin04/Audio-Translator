class VAD {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.fftSize = options.fftSize || 2048;
    this.smoothingTimeConstant = options.smoothingTimeConstant || 0.8;
    this.energyThreshold = options.energyThreshold || 0.01;
    this.energyThresholdRatioPos = options.energyThresholdRatioPos || 2;
    this.energyThresholdRatioNeg = options.energyThresholdRatioNeg || 0.5;
    this.minCaptureFreq = options.minCaptureFreq || 85;
    this.maxCaptureFreq = options.maxCaptureFreq || 300;
    this.noiseCaptureDuration = options.noiseCaptureDuration || 1000;
    this.minNoiseLevel = options.minNoiseLevel || 0.001;
    this.maxNoiseLevel = options.maxNoiseLevel || 0.02;
    this.avgNoiseMultiplier = options.avgNoiseMultiplier || 1.2;
    this.isNoiseCapturing = true;
    this.noiseLevel = 0;
    this.noiseData = [];
    this.captureStartTime = Date.now();
  }

  calculateEnergy(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  calculateSpectralEnergy(frequencyData, minFreq, maxFreq) {
    const minIndex = Math.floor(minFreq * this.fftSize / this.sampleRate);
    const maxIndex = Math.ceil(maxFreq * this.fftSize / this.sampleRate);
    let sum = 0;
    for (let i = minIndex; i < maxIndex && i < frequencyData.length; i++) {
      sum += frequencyData[i];
    }
    return sum / (maxIndex - minIndex);
  }

  process(audioData, analyser = null) {
    const energy = this.calculateEnergy(audioData);
    
    if (this.isNoiseCapturing) {
      if (Date.now() - this.captureStartTime < this.noiseCaptureDuration) {
        this.noiseData.push(energy);
        return { isSpeech: false, energy, noiseLevel: 0 };
      } else {
        this.isNoiseCapturing = false;
        const avgNoise = this.noiseData.reduce((a, b) => a + b, 0) / this.noiseData.length;
        this.noiseLevel = Math.max(this.minNoiseLevel, Math.min(this.maxNoiseLevel, avgNoise * this.avgNoiseMultiplier));
      }
    }

    const threshold = Math.max(this.energyThreshold, this.noiseLevel * this.energyThresholdRatioPos);
    let isSpeech = energy > threshold;

    if (analyser && isSpeech) {
      const frequencyData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(frequencyData);
      const spectralEnergy = this.calculateSpectralEnergy(frequencyData, this.minCaptureFreq, this.maxCaptureFreq);
      isSpeech = spectralEnergy > 10;
    }

    return { isSpeech, energy, noiseLevel: this.noiseLevel };
  }

  reset() {
    this.isNoiseCapturing = true;
    this.noiseLevel = 0;
    this.noiseData = [];
    this.captureStartTime = Date.now();
  }
}

export default VAD;