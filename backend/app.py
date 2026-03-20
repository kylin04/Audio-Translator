from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from backend.services.translation_service import TranslationService
from backend.services.asr_service import ASRService
import json
import base64
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

translation_service = TranslationService()
asr_service = ASRService()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session_id = None
    source_lang = "zh"
    target_lang = "en"
    
    try:
        while True:
            message = await websocket.receive()
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                    if "session_id" in data:
                        session_id = data["session_id"]
                        source_lang = data.get("source_lang", "zh")
                        target_lang = data.get("target_lang", "en")
                        logger.info(f"[{session_id}] 会话已初始化: {source_lang} -> {target_lang}")
                    elif "type" in data and data["type"] == "audio":
                        # 接收到前端发来的 base64 音频数据
                        audio_bytes = base64.b64decode(data["data"])
                        logger.info(f"[{session_id}] 收到音频数据: {len(audio_bytes)} bytes")
                        
                        # 1. 将音频传给 ASR 服务进行识别
                        recognized_text = await asr_service.recognize_audio(audio_bytes)
                        logger.info(f"[{session_id}] 识别结果: {recognized_text}")
                        
                        if recognized_text:
                            # 2. 将识别出的文本传给翻译服务
                            translated_text = await translation_service.translate(
                                recognized_text, 
                                source_lang=source_lang, 
                                target_lang=target_lang,
                                session_id=session_id
                            )
                            logger.info(f"[{session_id}] 翻译结果: {translated_text}")
                            
                            # 3. 将结果发回给前端
                            await websocket.send_json({
                                "type": "result",
                                "text": recognized_text,
                                "translation": translated_text
                            })
                        else:
                            await websocket.send_json({
                                "type": "result",
                                "text": "未能识别出语音内容，请大声重试。",
                                "translation": "Failed to recognize speech, please try again louder."
                            })

                except json.JSONDecodeError:
                    pass
            elif "bytes" in message:
                # 处理纯二进制流 (备用方案)
                pass
    except WebSocketDisconnect:
        logger.info(f"[{session_id}] WebSocket连接断开")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)