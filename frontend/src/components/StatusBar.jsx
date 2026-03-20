import React from 'react';
import { FaCircle, FaMicrophone, FaLanguage, FaVolumeUp, FaWifi } from 'react-icons/fa';

const StatusBar = ({ connectionStatus, isRecording, processingStage, sessionStats }) => {
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-gray-400';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return '已连接';
      case 'connecting':
        return '连接中';
      case 'disconnected':
        return '未连接';
      case 'error':
        return '连接错误';
      default:
        return '未知';
    }
  };

  const getStageIcon = (stage) => {
    switch (stage) {
      case 'asr':
        return <FaMicrophone className="w-4 h-4" />;
      case 'translation':
        return <FaLanguage className="w-4 h-4" />;
      case 'tts':
        return <FaVolumeUp className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getStageText = (stage) => {
    switch (stage) {
      case 'asr':
        return '语音识别';
      case 'translation':
        return '翻译处理';
      case 'tts':
        return '语音合成';
      default:
        return '待处理';
    }
  };

  return (
    <div className="w-full bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <FaWifi className={`w-4 h-4 ${getStatusColor()}`} />
              <span className="text-sm font-medium text-gray-700">
                {getStatusText()}
              </span>
              <FaCircle className={`w-2 h-2 ${getStatusColor()} ${connectionStatus === 'connected' ? 'animate-pulse' : ''}`} />
            </div>

            {isRecording && (
              <div className="flex items-center gap-2 px-3 py-1 bg-red-50 rounded-full border border-red-200">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs font-medium text-red-700">录音中</span>
              </div>
            )}

            {processingStage && (
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-full border border-blue-200">
                <div className="text-blue-600">
                  {getStageIcon(processingStage)}
                </div>
                <span className="text-xs font-medium text-blue-700">
                  {getStageText(processingStage)}
                </span>
              </div>
            )}
          </div>

          {sessionStats && connectionStatus === 'connected' && (
            <div className="flex items-center gap-4 text-xs text-gray-600">
              {sessionStats.asr_results > 0 && (
                <div className="flex items-center gap-1">
                  <FaMicrophone className="w-3 h-3" />
                  <span>{sessionStats.asr_results}</span>
                </div>
              )}
              {sessionStats.translations > 0 && (
                <div className="flex items-center gap-1">
                  <FaLanguage className="w-3 h-3" />
                  <span>{sessionStats.translations}</span>
                </div>
              )}
              {sessionStats.tts_results > 0 && (
                <div className="flex items-center gap-1">
                  <FaVolumeUp className="w-3 h-3" />
                  <span>{sessionStats.tts_results}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {connectionStatus === 'error' && (
          <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-700">
              连接失败，请检查网络或刷新页面重试
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatusBar;