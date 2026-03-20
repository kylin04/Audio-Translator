import os
import sys
import logging
import asyncio
import json
from datetime import datetime
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from services.coordinator import coordinator
from config.settings import settings
from utils.cache import translation_cache

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def global_exception_handler(exctype, value, traceback):
    logging.critical("未捕获的全局异常", exc_info=(exctype, value, traceback))

sys.excepthook = global_exception_handler

# 优化静态文件路径检测
static_folder = None
for folder in ['../frontend/dist', '../frontend/public', '../frontend/build']:
    if os.path.exists(folder):
        static_folder = folder
        logger.info(f'静态文件目录: {folder}')
        break

app = FastAPI(title="Real-Time Translation By HAISNAP", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.session_buffers: Dict[str, list] = {}
        self.connection_timestamps: Dict[str, float] = {}
        self.heartbeat_interval = 30  # 心跳间隔（秒）
    
    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        self.session_buffers[session_id] = []
        self.connection_timestamps[session_id] = datetime.now().timestamp()
        logger.info(f'[{session_id}] WebSocket连接建立')
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            self.active_connections.pop(session_id)
        if session_id in self.session_buffers:
            self.session_buffers.pop(session_id)
        if session_id in self.connection_timestamps:
            self.connection_timestamps.pop(session_id)
        logger.info(f'[{session_id}] WebSocket连接断开')
    
    async def send_message(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            ws = self.active_connections[session_id]
            try:
                # 检查连接状态
                if ws.client_state.name != 'CONNECTED':
                    logger.warning(f'[{session_id}] WebSocket未连接，状态: {ws.client_state.name}')
                    return False
                
                await ws.send_json(message)
                return True
            except Exception as e:
                logger.error(f'[{session_id}] 发送消息失败: {e}')
                # 连接异常时清理
                self.disconnect(session_id)
                return False
        return False
    
    def get_buffer(self, session_id: str) -> list:
        return self.session_buffers.get(session_id, [])
    
    def add_to_buffer(self, session_id: str, data: bytes):
        if session_id not in self.session_buffers:
            self.session_buffers[session_id] = []
        self.session_buffers[session_id].append(data)
    
    def clear_buffer(self, session_id: str):
        if session_id in self.session_buffers:
            self.session_buffers[session_id] = []

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    try:
        await coordinator.initialize()
        logger.info('应用启动完成，所有服务已初始化')
    except Exception as e:
        logger.error(f'应用启动失败: {e}')

@app.on_event("shutdown")
async def shutdown_event():
    try:
        await coordinator.close()
        logger.info('应用关闭完成')
    except Exception as e:
        logger.error(f'应用关闭失败: {e}')

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    session_id = None
    try:
        await websocket.accept()
        
        init_message = await websocket.receive_json()
        session_id = init_message.get('session_id', f'session_{datetime.now().timestamp()}')
        source_lang = init_message.get('source_lang', 'zh')
        target_lang = init_message.get('target_lang', 'en')
        
        await manager.connect(websocket, session_id)
        
        await manager.send_message(session_id, {
            'type': 'connected',
            'session_id': session_id,
            'message': '连接成功',
            'timestamp': datetime.now().isoformat()
        })
        
        async def audio_generator():
            try:
                receive_timeout = 300  # 5分钟超时
                while True:
                    try:
                        data = await asyncio.wait_for(
                            websocket.receive(), 
                            timeout=receive_timeout
                        )
                    except asyncio.TimeoutError:
                        logger.warning(f'[{session_id}] 接收数据超时')
                        break
                    
                    if 'bytes' in data:
                        audio_chunk = data['bytes']
                        if len(audio_chunk) > 0:
                            manager.add_to_buffer(session_id, audio_chunk)
                            yield audio_chunk
                    
                    elif 'text' in data:
                        try:
                            message = json.loads(data['text'])
                            
                            if message.get('type') == 'end':
                                logger.info(f'[{session_id}] 收到结束信号')
                                break
                            elif message.get('type') == 'ping':
                                # 心跳响应
                                await manager.send_message(session_id, {'type': 'pong'})
                        except json.JSONDecodeError as e:
                            logger.error(f'[{session_id}] JSON解析失败: {e}')
            
            except WebSocketDisconnect:
                logger.info(f'[{session_id}] 客户端断开连接')
            except asyncio.CancelledError:
                logger.info(f'[{session_id}] 音频接收任务被取消')
                raise
            except Exception as e:
                logger.error(f'[{session_id}] 音频接收异常: {type(e).__name__} - {e}')
        
        async def send_callback(result: dict):
            await manager.send_message(session_id, result)
        
        logger.info(f'[{session_id}] 开始处理音频流')
        
        async for result in coordinator.process_stream(
            audio_generator(),
            session_id,
            source_lang,
            target_lang,
            send_callback
        ):
            if result.get('type') == 'tts':
                await manager.send_message(session_id, {
                    'type': 'result',
                    'session_id': session_id,
                    'original_text': result.get('original_text'),
                    'translated_text': result.get('translated_text'),
                    'audio_data': result.get('audio_data').hex() if result.get('audio_data') else '',
                    'timestamp': result.get('timestamp')
                })
            
            elif result.get('type') == 'error':
                await manager.send_message(session_id, {
                    'type': 'error',
                    'session_id': session_id,
                    'error': result.get('error'),
                    'timestamp': result.get('timestamp')
                })
        
        stats = coordinator.get_session_stats(session_id)
        await manager.send_message(session_id, {
            'type': 'completed',
            'session_id': session_id,
            'stats': stats,
            'timestamp': datetime.now().isoformat()
        })
        
        logger.info(f'[{session_id}] 处理完成')
    
    except WebSocketDisconnect as e:
        logger.info(f'[{session_id}] WebSocket正常断开: code={e.code}')
    except asyncio.CancelledError:
        logger.info(f'[{session_id}] WebSocket任务被取消')
    except ConnectionError as e:
        logger.error(f'[{session_id}] WebSocket连接错误: {e}')
    except Exception as e:
        logger.error(f'[{session_id}] WebSocket未知异常: {type(e).__name__} - {e}', exc_info=True)
        if session_id:
            try:
                await manager.send_message(session_id, {
                    'type': 'error',
                    'error': str(e),
                    'timestamp': datetime.now().isoformat()
                })
            except Exception as send_error:
                logger.error(f'[{session_id}] 发送错误消息失败: {send_error}')
    finally:
        if session_id:
            try:
                manager.disconnect(session_id)
                coordinator.clear_session(session_id)
                logger.info(f'[{session_id}] 会话资源清理完成')
            except Exception as cleanup_error:
                logger.error(f'[{session_id}] 清理资源失败: {cleanup_error}')

@app.get("/api/stats")
async def get_stats():
    try:
        stats = coordinator.get_system_stats()
        return JSONResponse(content=stats)
    except Exception as e:
        logger.error(f'获取统计信息失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sessions")
async def get_sessions():
    try:
        sessions = coordinator.get_all_sessions()
        return JSONResponse(content=sessions)
    except Exception as e:
        logger.error(f'获取会话信息失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cache/stats")
async def get_cache_stats():
    try:
        stats = translation_cache.get_stats()
        return JSONResponse(content=stats)
    except Exception as e:
        logger.error(f'获取缓存统计失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/cache/clear")
async def clear_cache():
    try:
        translation_cache.clear()
        return JSONResponse(content={'message': '缓存已清空'})
    except Exception as e:
        logger.error(f'清空缓存失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/config")
async def get_config():
    try:
        return JSONResponse(content={
            'asr_provider': settings.ASR_PROVIDER,
            'translation_provider': settings.TRANSLATION_PROVIDER,
            'tts_provider': settings.TTS_PROVIDER,
            'source_language': settings.SOURCE_LANGUAGE,
            'target_language': settings.TARGET_LANGUAGE,
            'audio_sample_rate': settings.AUDIO_SAMPLE_RATE,
            'opus_bitrate': settings.OPUS_BITRATE,
            'chunk_duration_ms': settings.CHUNK_DURATION_MS
        })
    except Exception as e:
        logger.error(f'获取配置信息失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/validate")
async def validate_services():
    try:
        results = await coordinator.validate_services()
        return JSONResponse(content=results)
    except Exception as e:
        logger.error(f'服务验证失败: {e}')
        raise HTTPException(status_code=500, detail=str(e))

if static_folder and os.path.exists(static_folder):
    try:
        app.mount("/", StaticFiles(directory=static_folder, html=True), name="static")
        logger.info(f'静态文件服务已启动: {static_folder}')
    except Exception as e:
        logger.warning(f'静态文件挂载失败: {e}')
else:
    logger.warning('未找到静态文件目录，仅启动API服务')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    uvicorn.run(
        "app:app",
        host='0.0.0.0',
        port=port,
        log_level="info",
        access_log=True
    )