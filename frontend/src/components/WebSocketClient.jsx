import React, { useEffect, useRef, useState, useCallback } from 'react';

const WebSocketClient = ({ 
  sessionId, 
  sourceLanguage = 'zh', 
  targetLanguage = 'en',
  onMessage,
  onError,
  onConnectionChange,
  children 
}) => {
  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const messageQueueRef = useRef([]);

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }, []);

  const processMessageQueue = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      while (messageQueueRef.current.length > 0) {
        const message = messageQueueRef.current.shift();
        wsRef.current.send(message);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnectionStatus('connecting');
    
    try {
      const wsUrl = getWebSocketUrl();
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('[WebSocket] 连接成功');
        setIsConnected(true);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;

        const initMessage = {
          session_id: sessionId,
          source_lang: sourceLanguage,
          target_lang: targetLanguage
        };
        wsRef.current.send(JSON.stringify(initMessage));

        processMessageQueue();

        if (onConnectionChange) {
          onConnectionChange('connected');
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (onMessage) {
            onMessage(data);
          }
        } catch (error) {
          console.error('[WebSocket] 消息解析失败:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[WebSocket] 连接错误:', error);
        setConnectionStatus('error');
        
        if (onError) {
          onError(error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('[WebSocket] 连接关闭:', event.code, event.reason);
        setIsConnected(false);
        setConnectionStatus('disconnected');

        if (onConnectionChange) {
          onConnectionChange('disconnected');
        }

        // 1000为正常关闭，不触发重连
        if (event.code === 1000 || !wsRef.current) {
          console.log('[WebSocket] 正常关闭，不进行重连');
          return;
        }

        // 检查是否应该重连
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          console.log(`[WebSocket] ${delay}ms后尝试重连 (${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current += 1;
            connect();
          }, delay);
        } else {
          console.error('[WebSocket] 达到最大重连次数，停止重连');
          setConnectionStatus('error');
          if (onConnectionChange) {
            onConnectionChange('error');
          }
        }
      };

    } catch (error) {
      console.error('[WebSocket] 创建连接失败:', error);
      setConnectionStatus('error');
      
      if (onError) {
        onError(error);
      }
    }
  }, [sessionId, sourceLanguage, targetLanguage, onMessage, onError, onConnectionChange, getWebSocketUrl, processMessageQueue]);

  const disconnect = useCallback(() => {
    console.log('[WebSocket] 主动断开连接');
    
    // 清理重连定时器
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // 关闭WebSocket连接
    if (wsRef.current) {
      try {
        // 移除所有事件监听器，防止触发onclose重连
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'end' }));
        }
        
        wsRef.current.close();
      } catch (error) {
        console.error('[WebSocket] 关闭连接时出错:', error);
      } finally {
        wsRef.current = null;
      }
    }

    // 重置状态
    setIsConnected(false);
    setConnectionStatus('disconnected');
    reconnectAttemptsRef.current = 0;
    messageQueueRef.current = [];
  }, []);

  const sendAudioChunk = useCallback((audioData) => {
    if (!audioData || audioData.byteLength === 0) {
      return false;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(audioData);
        return true;
      } catch (error) {
        console.error('[WebSocket] 发送音频失败:', error);
        // 限制队列大小为50条，避免内存溢出
        if (messageQueueRef.current.length < 50) {
          messageQueueRef.current.push(audioData);
        } else {
          console.warn('[WebSocket] 消息队列已满，丢弃旧数据');
          messageQueueRef.current.shift();
          messageQueueRef.current.push(audioData);
        }
        return false;
      }
    } else {
      // 限制队列大小
      if (messageQueueRef.current.length < 50) {
        messageQueueRef.current.push(audioData);
      }
      
      if (connectionStatus === 'disconnected' && !reconnectTimeoutRef.current) {
        connect();
      }
      
      return false;
    }
  }, [connectionStatus, connect]);

  const sendMessage = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('[WebSocket] 发送消息失败:', error);
        return false;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    if (sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <>
      {typeof children === 'function' 
        ? children({ 
            isConnected, 
            connectionStatus, 
            sendAudioChunk, 
            sendMessage,
            connect,
            disconnect 
          })
        : children
      }
    </>
  );
};

export default WebSocketClient;