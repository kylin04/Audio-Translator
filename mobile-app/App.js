import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { Audio } from 'expo-av';

// 注意：这是通过 localtunnel 穿透的后端公网地址
const BACKEND_WS_URL = 'wss://haisnap-translation.loca.lt/ws';

export default function App() {
  const [recording, setRecording] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const recordingRef = useRef(null);

  useEffect(() => {
    // 建立 WebSocket 连接
    try {
      wsRef.current = new WebSocket(BACKEND_WS_URL);

      wsRef.current.onopen = () => {
        console.log('已连接到后端 WebSocket');
        setIsConnected(true);
        // 发送初始化配置
        wsRef.current.send(JSON.stringify({
          session_id: `session_${Date.now()}`,
          source_lang: 'zh',
          target_lang: 'en'
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'result' && data.text) {
            setMessages(prev => [...prev, data]);
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
      };
    } catch (e) {
      console.error("WebSocket 初始化失败", e);
    }

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
          }
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        console.error("读取音频文件失败:", e);
      }

    } catch (err) {
      console.error('停止录音失败', err);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>同声传译 App</Text>
      
      <View style={styles.statusBox}>
        <Text style={styles.statusText}>
          服务器连接状态: {isConnected ? '🟢 已连接' : '🔴 未连接'}
        </Text>
      </View>

      <TouchableOpacity 
        style={[styles.button, recording ? styles.buttonRecording : null]} 
        onPress={recording ? stopRecording : startRecording}
      >
        <Text style={styles.buttonText}>
          {recording ? '停止录音' : '开始录音'}
        </Text>
      </TouchableOpacity>

      <ScrollView style={styles.messageContainer}>
        {messages.map((msg, index) => (
          <View key={index} style={styles.messageBubble}>
            <Text style={styles.originalText}>中文: {msg.text}</Text>
            {msg.translation && <Text style={styles.translatedText}>English: {msg.translation}</Text>}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
    paddingTop: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  statusBox: {
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  statusText: {
    fontSize: 16,
    color: '#555',
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 30,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  buttonRecording: {
    backgroundColor: '#f44336',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  messageContainer: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageBubble: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 10,
  },
  originalText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
  },
  translatedText: {
    fontSize: 16,
    color: '#2196F3',
    fontWeight: '500',
  }
});