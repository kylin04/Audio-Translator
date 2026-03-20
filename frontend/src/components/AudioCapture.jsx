import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import OpusEncoder from '../utils/opusEncoder';
import VAD from '../utils/vad';

const AudioCapture = ({ 
  isRecording, 
  onAudioData, 
  onRecordingStateChange,
  onVadResult,
  onError 
}) => {
  const [audioContext, setAudioContext] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [vadState, setVadState] = useState({ isSpeech: false, energy: 0 });
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const opusEncoderRef = useRef(null);
  const vadRef = useRef(null);
  const audioWorkletNodeRef = useRef(null);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  }, [isRecording]);

  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(err => console.error('关闭音频上下文失败:', err));
      setAudioContext(null);
    }
    if (opusEncoderRef.current) {
      opusEncoderRef.current.destroy();
      opusEncoderRef.current = null;
    }
  }, [audioContext]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      mediaStreamRef.current = stream;
      const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      setAudioContext(context);

      const analyserNode = context.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.8;
      setAnalyser(analyserNode);

      const source = context.createMediaStreamSource(stream);
      source.connect(analyserNode);

      opusEncoderRef.current = new OpusEncoder({
        sampleRate: 16000,
        channels: 1,
        bitrate: 24000,
        frameSize: 960
      });

      vadRef.current = new VAD({
        sampleRate: 16000,
        energyThreshold: 0.01,
        minCaptureFreq: 85,
        maxCaptureFreq: 300
      });

      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = async (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const inputSampleRate = context.sampleRate;

        const vadResult = vadRef.current.process(inputData, analyserNode);
        setVadState(vadResult);
        
        if (onVadResult) {
          onVadResult(vadResult);
        }

        if (vadResult.isSpeech) {
          try {
            const encodedData = await opusEncoderRef.current.encode(inputData, inputSampleRate);
            
            if (encodedData && encodedData.byteLength > 0 && onAudioData) {
              onAudioData(encodedData);
            }
          } catch (error) {
            console.error('音频编码失败:', error);
            if (onError) {
              onError(error);
            }
          }
        }
      };

      source.connect(processor);
      processor.connect(context.destination);

      if (onRecordingStateChange) {
        onRecordingStateChange(true);
      }

    } catch (error) {
      console.error('启动录音失败:', error);
      if (onError) {
        onError(error);
      }
      if (onRecordingStateChange) {
        onRecordingStateChange(false);
      }
    }
  }, [onAudioData, onRecordingStateChange, onVadResult, onError]);

  const stopRecording = useCallback(() => {
    if (opusEncoderRef.current) {
      try {
        const finalData = opusEncoderRef.current.flush();
        if (finalData && finalData.byteLength > 0 && onAudioData) {
          onAudioData(finalData);
        }
      } catch (error) {
        console.error('刷新编码器失败:', error);
      }
    }

    cleanup();
    setVadState({ isSpeech: false, energy: 0 });
    setAnalyser(null);

    if (onRecordingStateChange) {
      onRecordingStateChange(false);
    }
  }, [cleanup, onAudioData, onRecordingStateChange]);

  return (
    <div className="w-full">
      {isRecording && vadState.isSpeech && (
        <div className="flex items-center justify-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-green-700">检测到语音</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600">能量:</span>
            <div className="w-32 bg-green-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-150"
                style={{ width: `${Math.min(vadState.energy * 200, 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono text-green-700">
              {(vadState.energy * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {isRecording && !vadState.isSpeech && (
        <div className="flex items-center justify-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="w-2 h-2 bg-gray-400 rounded-full" />
          <span className="text-xs text-gray-500">等待语音输入...</span>
        </div>
      )}

      {isRecording && opusEncoderRef.current && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>压缩比: {opusEncoderRef.current.getCompressionRatio()}x</span>
          <span>带宽: {opusEncoderRef.current.getEstimatedBandwidth()}</span>
        </div>
      )}
    </div>
  );
};

export default AudioCapture;