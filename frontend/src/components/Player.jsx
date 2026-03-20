import React, { useEffect, useRef, useState } from 'react';
import { FaPlay, FaPause, FaVolumeUp, FaVolumeMute, FaLanguage, FaMicrophone } from 'react-icons/fa';

const Player = ({ originalText, translatedText, audioData, onPlayStateChange }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const gainNodeRef = useRef(null);

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }

    return () => {
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  useEffect(() => {
    if (audioData && audioData.length > 0) {
      playAudio(audioData);
    }
  }, [audioData]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const playAudio = async (data) => {
    try {
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch (e) {}
      }

      const audioContext = audioContextRef.current;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      let audioBuffer;
      if (typeof data === 'string') {
        const binaryData = new Uint8Array(data.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        audioBuffer = await audioContext.decodeAudioData(binaryData.buffer);
      } else if (data instanceof ArrayBuffer) {
        audioBuffer = await audioContext.decodeAudioData(data);
      } else {
        return;
      }

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNodeRef.current);
      
      setDuration(audioBuffer.duration);
      setIsPlaying(true);
      
      if (onPlayStateChange) {
        onPlayStateChange(true);
      }

      const startTime = audioContext.currentTime;
      const updateTime = setInterval(() => {
        const elapsed = audioContext.currentTime - startTime;
        if (elapsed >= audioBuffer.duration) {
          clearInterval(updateTime);
          setCurrentTime(0);
          setIsPlaying(false);
          if (onPlayStateChange) {
            onPlayStateChange(false);
          }
        } else {
          setCurrentTime(elapsed);
        }
      }, 100);

      source.onended = () => {
        clearInterval(updateTime);
        setCurrentTime(0);
        setIsPlaying(false);
        if (onPlayStateChange) {
          onPlayStateChange(false);
        }
      };

      source.start(0);
      sourceNodeRef.current = source;

    } catch (error) {
      console.error('音频播放失败:', error);
      setIsPlaying(false);
      if (onPlayStateChange) {
        onPlayStateChange(false);
      }
    }
  };

  const togglePlay = () => {
    if (isPlaying && sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        setIsPlaying(false);
        setCurrentTime(0);
        if (onPlayStateChange) {
          onPlayStateChange(false);
        }
      } catch (e) {}
    } else if (audioData) {
      playAudio(audioData);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center gap-2 mb-3">
              <FaMicrophone className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-blue-900">原文</h3>
            </div>
            <div className="bg-white rounded-md p-3 min-h-24 max-h-32 overflow-y-auto">
              <p className="text-gray-800 leading-relaxed">
                {originalText || <span className="text-gray-400 italic">等待识别...</span>}
              </p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-4 border border-amber-200">
            <div className="flex items-center gap-2 mb-3">
              <FaLanguage className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-900">译文</h3>
            </div>
            <div className="bg-white rounded-md p-3 min-h-24 max-h-32 overflow-y-auto">
              <p className="text-gray-800 leading-relaxed">
                {translatedText || <span className="text-gray-400 italic">等待翻译...</span>}
              </p>
            </div>
          </div>
        </div>

        {audioData && (
          <div className="bg-gradient-to-r from-gray-50 to-slate-50 rounded-lg p-5 border border-gray-200">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="flex-shrink-0 w-12 h-12 flex items-center justify-center bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-full shadow-md transition-all duration-200 hover:shadow-lg transform hover:scale-105"
                aria-label={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? (
                  <FaPause className="w-5 h-5" />
                ) : (
                  <FaPlay className="w-5 h-5 ml-0.5" />
                )}
              </button>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-600 w-12">
                    {formatTime(currentTime)}
                  </span>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-150"
                      style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-gray-600 w-12 text-right">
                    {formatTime(duration)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={toggleMute}
                  className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-amber-600 transition-colors"
                  aria-label={isMuted ? '取消静音' : '静音'}
                >
                  {isMuted ? (
                    <FaVolumeMute className="w-5 h-5" />
                  ) : (
                    <FaVolumeUp className="w-5 h-5" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer accent-amber-500"
                  aria-label="音量控制"
                />
              </div>
            </div>
          </div>
        )}

        {!originalText && !translatedText && !audioData && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-amber-100 to-orange-100 rounded-full mb-4">
              <FaMicrophone className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-gray-500 text-sm">
              点击开始录音按钮，开始您的同声传译之旅
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Player;