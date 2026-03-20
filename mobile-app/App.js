import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator } from 'react-native';
import { Audio } from 'expo-av';

// 注意：这是通过 localtunnel 穿透的后端公网地址
const BACKEND_WS_URL = 'wss://long-doodles-kiss.loca.lt/ws';

export default function App() {
  const [recording, setRecording] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // 新增：处理中状态
  const [messages, setMessages] = useState([]);
  const [sourceLang, setSourceLang] = useState('zh'); // 新增：源语言
  const [targetLang, setTargetLang] = useState('en'); // 新增：目标语言
  const wsRef = useRef(null);
  const recordingRef = useRef(null);

  useEffect(() => {
    connectWebSocket();
    // 请求麦克风权限
    (async () => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          alert('抱歉，我们需要麦克风权限才能进行同声传译！');
        }
      } catch (e) {
        console.error("请求麦克风权限失败", e);
      }
    })();

    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (e) {}
      }
    };
  }, []);

  const connectWebSocket = () => {
    try {
      wsRef.current = new WebSocket(BACKEND_WS_URL);

      wsRef.current.onopen = () => {
        console.log('已连接到后端 WebSocket');
        setIsConnected(true);
        // 发送初始化配置
        wsRef.current.send(JSON.stringify({
          session_id: `session_${Date.now()}`,
          source_lang: sourceLang,
          target_lang: targetLang
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'result' && data.text) {
            setMessages(prev => [...prev, data]);
            setIsProcessing(false); // 收到结果，结束处理状态
          }
        } catch (e) {
          console.error("解析消息失败", e);
        }
      };

      wsRef.current.onerror = (e) => {
        console.error("WebSocket 错误", e);
      };
      
      wsRef.current.onclose = () => {
        console.log('WebSocket 连接已关闭');
        setIsConnected(false);
        setIsProcessing(false);
      };
    } catch (e) {
      console.error("WebSocket 初始化失败", e);
    }
  };

  async function startRecording() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('开始录音...');
      // 配置高频采样，以支持流式传输
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
          audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MAX,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
      });

      recording.setOnRecordingStatusUpdate((status) => {
        // 每当有新的录音状态更新时，我们可以考虑在这里获取音频切片发送
        // 但 expo-av 默认不直接暴露流式 buffer，我们需要用定时器读取文件
      });

      setRecording(recording);
      recordingRef.current = recording;
      console.log('录音中...');
    } catch (err) {
      console.error('无法启动录音', err);
    }
  }

  async function stopRecording() {
    console.log('停止录音...');
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      console.log('录音文件保存在:', uri);
      
      setRecording(null);
      recordingRef.current = null;
      
      // 读取音频文件并转成 base64 发送给后端
      try {
        setIsProcessing(true); // 开始处理状态
        // 在 React Native 中，可以通过 fetch 将本地文件转为 blob，再用 FileReader 转 base64
        const response = await fetch(uri);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const base64data = reader.result.split(',')[1];
          if (wsRef.current && isConnected) {
             wsRef.current.send(JSON.stringify({
                type: "audio",
                data: base64data
             }));
             console.log("音频数据已发送给后端");
          } else {
             setIsProcessing(false);
          }
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        console.error("读取音频文件失败:", e);
        setIsProcessing(false);
      }

    } catch (err) {
      console.error('停止录音失败', err);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>同声传译 Pro</Text>
      
      <View style={styles.statusBox}>
        <Text style={styles.statusText}>
          服务器: {isConnected ? '🟢 已连接' : '🔴 未连接'}
        </Text>
        {!isConnected && (
          <TouchableOpacity onPress={connectWebSocket} style={styles.reconnectBtn}>
            <Text style={styles.reconnectText}>重连</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.langSelector}>
        <TouchableOpacity 
          style={[styles.langBtn, sourceLang === 'zh' ? styles.langBtnActive : null]}
          onPress={() => { setSourceLang('zh'); setTargetLang('en'); }}
        >
          <Text style={styles.langText}>中 ➔ 英</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.langBtn, sourceLang === 'en' ? styles.langBtnActive : null]}
          onPress={() => { setSourceLang('en'); setTargetLang('zh'); }}
        >
          <Text style={styles.langText}>英 ➔ 中</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.recordContainer}>
        <TouchableOpacity 
          style={[
            styles.recordButton, 
            recording ? styles.recordingActive : null,
            !isConnected ? styles.buttonDisabled : null
          ]} 
          onPress={recording ? stopRecording : startRecording}
          disabled={!isConnected || isProcessing}
        >
          <Text style={styles.recordButtonText}>
            {recording ? '⏹ 停止并翻译' : '⏺ 按下开始说话'}
          </Text>
        </TouchableOpacity>
        
        {isProcessing && (
          <View style={styles.processingView}>
            <ActivityIndicator size="small" color="#2196F3" />
            <Text style={styles.processingText}>正在云端翻译...</Text>
          </View>
        )}
      </View>

      <ScrollView style={styles.messageContainer}>
        {messages.length === 0 && !isProcessing && (
          <Text style={styles.emptyText}>录音结果将显示在这里...</Text>
        )}
        {messages.map((msg, index) => (
          <View key={index} style={styles.messageBubble}>
            <Text style={styles.originalText}>{sourceLang === 'zh' ? '中文' : 'English'}: {msg.text}</Text>
            {msg.translation && <Text style={styles.translatedText}>{targetLang === 'en' ? 'English' : '中文'}: {msg.translation}</Text>}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F9FC',
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 15,
    color: '#1A237E',
  },
  statusBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statusText: {
    fontSize: 15,
    color: '#455A64',
    fontWeight: '500',
  },
  reconnectBtn: {
    marginLeft: 15,
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 15,
  },
  reconnectText: {
    color: '#1976D2',
    fontSize: 12,
    fontWeight: 'bold',
  },
  langSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 10,
  },
  langBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#E0E0E0',
  },
  langBtnActive: {
    backgroundColor: '#2196F3',
  },
  langText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  recordContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  recordButton: {
    backgroundColor: '#4CAF50',
    width: 200,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  recordingActive: {
    backgroundColor: '#F44336',
    shadowColor: '#F44336',
  },
  buttonDisabled: {
    backgroundColor: '#BDBDBD',
    shadowOpacity: 0,
  },
  recordButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  processingView: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 15,
  },
  processingText: {
    marginLeft: 8,
    color: '#2196F3',
    fontSize: 14,
  },
  messageContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 3,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9E9E9E',
    marginTop: 20,
    fontStyle: 'italic',
  },
  messageBubble: {
    padding: 12,
    backgroundColor: '#F5F7FA',
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  originalText: {
    fontSize: 15,
    color: '#424242',
    marginBottom: 6,
  },
  translatedText: {
    fontSize: 16,
    color: '#1565C0',
    fontWeight: '600',
  }
});