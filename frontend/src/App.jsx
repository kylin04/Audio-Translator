import React, { useState, useEffect, useRef } from 'react';
import { FaMicrophone, FaStop, FaCog, FaGlobeAmericas } from 'react-icons/fa';
import StatusBar from './components/StatusBar';
import AudioCapture from './components/AudioCapture';
import WebSocketClient from './components/WebSocketClient';
import Player from './components/Player';
import WaveformVisualizer from './components/WaveformVisualizer';

const App = () => {
  const [sessionId] = useState(`session_${Date.now()}`);
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [processingStage, setProcessingStage] = useState(null);
  const [sessionStats, setSessionStats] = useState(null);
  const [currentResult, setCurrentResult] = useState({
    originalText: '',
    translatedText: '',
    audioData: null
  });
  const [audioContext, setAudioContext] = useState(null);
  const [analyser, setAnalyser] = useState(null);
  const [sourceLanguage, setSourceLanguage] = useState('zh');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [vadResult, setVadResult] = useState({ isSpeech: false, energy: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const sendAudioChunkRef = useRef(null);
  const wsClientRef = useRef(null);

  useEffect(() => {
    document.title = 'Real-Time Translation By HAISNAP';
    
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; }
    `;
    document.head.appendChild(style);

    return () => {
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(err => console.error('音频上下文关闭失败:', err));
      }
    };
  }, [audioContext]);

  const handleWebSocketMessage = (data) => {
    if (data.type === 'asr') {
      setProcessingStage('asr');
      setCurrentResult(prev => ({
        ...prev,
        originalText: prev.originalText + (prev.originalText ? ' ' : '') + data.text
      }));
    } else if (data.type === 'translation') {
      setProcessingStage('translation');
      setCurrentResult(prev => ({
        ...prev,
        originalText: data.original_text,
        translatedText: data.translated_text
      }));
    } else if (data.type === 'result') {
      setProcessingStage('tts');
      setCurrentResult({
        originalText: data.original_text,
        translatedText: data.translated_text,
        audioData: data.audio_data
      });
      setTimeout(() => setProcessingStage(null), 1000);
    } else if (data.type === 'completed') {
      setSessionStats(data.stats);
      setProcessingStage(null);
    } else if (data.type === 'error') {
      console.error('WebSocket错误:', data.error);
      setProcessingStage(null);
    }
  };

  const handleConnectionChange = (status) => {
    setConnectionStatus(status);
  };

  const handleAudioData = (audioData) => {
    if (sendAudioChunkRef.current && audioData && connectionStatus === 'connected') {
      sendAudioChunkRef.current(audioData);
    }
  };

  const handleRecordingStateChange = (recording) => {
    setIsRecording(recording);
  };

  const handleVadResult = (result) => {
    setVadResult(result);
  };

  const handleAudioContextCreated = (context) => {
    setAudioContext(context);
  };

  const handleAnalyserCreated = (analyserNode) => {
    setAnalyser(analyserNode);
  };

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      setCurrentResult({
        originalText: '',
        translatedText: '',
        audioData: null
      });
      setProcessingStage(null);
      setVadResult({ isSpeech: false, energy: 0 });
    } else {
      if (connectionStatus === 'connected') {
        setIsRecording(true);
      }
    }
  };

  const languageOptions = [
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-50 via-cream-100 to-cream-200">
      <StatusBar
        connectionStatus={connectionStatus}
        isRecording={isRecording}
        processingStage={processingStage}
        sessionStats={sessionStats}
      />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cocoa-700 to-cocoa-600 mb-2">
            实时同声传译系统
          </h1>
          <p className="text-cocoa-500 text-sm">
            边说边译，专业高效的语音翻译服务
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-cocoa-800 flex items-center gap-2">
                  <FaGlobeAmericas className="text-cocoa-600" />
                  语言设置
                </h2>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="设置"
                >
                  <FaCog className={`w-5 h-5 text-gray-600 ${showSettings ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {showSettings && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      源语言
                    </label>
                    <select
                      value={sourceLanguage}
                      onChange={(e) => setSourceLanguage(e.target.value)}
                      className="w-full px-4 py-2 border border-cocoa-200 rounded-lg focus:ring-2 focus:ring-cocoa-500 focus:border-transparent bg-white"
                      disabled={isRecording}
                    >
                      {languageOptions.map(lang => (
                        <option key={lang.code} value={lang.code}>
                          {lang.flag} {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      目标语言
                    </label>
                    <select
                      value={targetLanguage}
                      onChange={(e) => setTargetLanguage(e.target.value)}
                      className="w-full px-4 py-2 border border-cocoa-200 rounded-lg focus:ring-2 focus:ring-cocoa-500 focus:border-transparent bg-white"
                      disabled={isRecording}
                    >
                      {languageOptions.map(lang => (
                        <option key={lang.code} value={lang.code}>
                          {lang.flag} {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center">
                <button
                  onClick={toggleRecording}
                  disabled={connectionStatus !== 'connected' && !isRecording}
                  className={`
                    w-20 h-20 rounded-full flex items-center justify-center
                    shadow-lg transform transition-all duration-200
                    ${isRecording
                      ? 'bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 scale-110'
                      : 'bg-gradient-to-r from-cocoa-500 to-cocoa-600 hover:from-cocoa-600 hover:to-cocoa-700'
                    }
                    ${connectionStatus !== 'connected' && !isRecording ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}
                    focus:outline-none focus:ring-4 focus:ring-cocoa-300
                  `}
                  aria-label={isRecording ? '停止录音' : '开始录音'}
                >
                  {isRecording ? (
                    <FaStop className="w-8 h-8 text-white" />
                  ) : (
                    <FaMicrophone className="w-8 h-8 text-white" />
                  )}
                </button>
              </div>

              <div className="mt-4 text-center">
                <p className="text-sm text-gray-600">
                  {isRecording ? '点击停止录音' : connectionStatus === 'connected' ? '点击开始录音' : '等待连接...'}
                </p>
              </div>
            </div>

            <WaveformVisualizer
              audioContext={audioContext}
              analyser={analyser}
              isRecording={isRecording}
            />

            <WebSocketClient
              sessionId={sessionId}
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
              onMessage={handleWebSocketMessage}
              onConnectionChange={handleConnectionChange}
              ref={wsClientRef}
            >
              {({ sendAudioChunk }) => {
                sendAudioChunkRef.current = sendAudioChunk;
                return null;
              }}
            </WebSocketClient>

            <AudioCapture
              isRecording={isRecording}
              onAudioData={handleAudioData}
              onRecordingStateChange={handleRecordingStateChange}
              onVadResult={handleVadResult}
              onAudioContextCreated={handleAudioContextCreated}
              onAnalyserCreated={handleAnalyserCreated}
            />
          </div>

          <div className="lg:col-span-1">
            <Player
              originalText={currentResult.originalText}
              translatedText={currentResult.translatedText}
              audioData={currentResult.audioData}
            />
          </div>
        </div>

        <footer className="text-center py-6 text-sm text-cocoa-400">
          <p>
            实时同声传译系统 · 专业高效 · 多语言支持 · Powered by HAISNAP
          </p>
        </footer>
      </div>
    </div>
  );
};

export default App;