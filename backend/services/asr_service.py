import logging
import asyncio
import base64
import hashlib
import hmac
import json
from typing import AsyncGenerator, Optional, Dict
from datetime import datetime
from urllib.parse import urlencode
import aiohttp
import websockets
from config.settings import settings
from utils.cache import translation_cache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ASRService:
    def __init__(self):
        self.config = settings.get_asr_config()
        self.provider = self.config.get('provider', 'azure')
        self.session = None
        self.is_initialized = False
        self.request_count = 0
        self.error_count = 0
        logger.info(f'ASR服务初始化: {self.provider}')
    
    async def initialize(self):
        if self.is_initialized:
            return
        try:
            timeout = aiohttp.ClientTimeout(total=60, connect=10)
            self.session = aiohttp.ClientSession(timeout=timeout)
            self.is_initialized = True
            logger.info('ASR服务初始化成功')
        except Exception as e:
            logger.error(f'ASR服务初始化失败: {e}')
    
    async def close(self):
        if self.session:
            await self.session.close()
            self.is_initialized = False
            logger.info('ASR服务已关闭')
    
    async def recognize_stream(self, audio_stream: AsyncGenerator[bytes, None], session_id: str) -> AsyncGenerator[str, None]:
        if not self.is_initialized:
            await self.initialize()
        
        if self.provider == 'azure':
            async for text in self._azure_asr_stream(audio_stream, session_id):
                yield text
        elif self.provider == 'xunfei':
            async for text in self._xunfei_asr_stream(audio_stream, session_id):
                yield text
        else:
            logger.warning(f'不支持的ASR提供商: {self.provider}')
            yield ''
    
    async def _azure_asr_stream(self, audio_stream: AsyncGenerator[bytes, None], session_id: str) -> AsyncGenerator[str, None]:
        api_key = self.config.get('key')
        region = self.config.get('region')
        language = self.config.get('language', 'zh-CN')
        
        if not api_key or not region:
            logger.error('Azure Speech配置不完整')
            yield ''
            return
        
        endpoint = f'wss://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1'
        params = {
            'language': language,
            'format': 'detailed'
        }
        url = f'{endpoint}?{urlencode(params)}'
        headers = {
            'Ocp-Apim-Subscription-Key': api_key
        }
        
        try:
            start_time = datetime.now()
            self.request_count += 1
            
            async with websockets.connect(url, extra_headers=headers) as ws:
                logger.info(f'[{session_id}] Azure ASR WebSocket连接成功')
                
                audio_config = {
                    'context': {
                        'system': {'version': '1.0.0'},
                        'audio': {'source': {'format': 'pcm', 'samplerate': 16000, 'channels': 1}}
                    }
                }
                await ws.send(json.dumps(audio_config))
                
                async def send_audio():
                    try:
                        async for chunk in audio_stream:
                            if chunk:
                                await ws.send(chunk)
                        await ws.send(json.dumps({'speech.endDetected': {}}))
                    except Exception as e:
                        logger.error(f'[{session_id}] 发送音频失败: {e}')
                
                send_task = asyncio.create_task(send_audio())
                
                try:
                    while True:
                        response = await asyncio.wait_for(ws.recv(), timeout=30)
                        
                        if isinstance(response, bytes):
                            continue
                        
                        data = json.loads(response)
                        
                        if 'RecognitionStatus' in data:
                            status = data['RecognitionStatus']
                            
                            if status == 'Success':
                                if 'DisplayText' in data:
                                    text = data['DisplayText']
                                    duration = (datetime.now() - start_time).total_seconds()
                                    logger.info(f'[{session_id}] Azure ASR识别: {text}, 耗时{duration:.2f}秒')
                                    yield text
                            elif status == 'EndOfDictation':
                                break
                            elif status in ['InitialSilenceTimeout', 'BabbleTimeout', 'Error']:
                                self.error_count += 1
                                logger.error(f'[{session_id}] Azure ASR错误: {status}')
                                break
                
                except asyncio.TimeoutError:
                    logger.warning(f'[{session_id}] Azure ASR接收超时')
                finally:
                    send_task.cancel()
        
        except Exception as e:
            self.error_count += 1
            logger.error(f'[{session_id}] Azure ASR异常: {e}')
            yield ''
    
    async def _xunfei_asr_stream(self, audio_stream: AsyncGenerator[bytes, None], session_id: str) -> AsyncGenerator[str, None]:
        app_id = self.config.get('app_id')
        api_key = self.config.get('api_key')
        api_secret = self.config.get('api_secret')
        
        if not all([app_id, api_key, api_secret]):
            logger.error('讯飞API配置不完整')
            yield ''
            return
        
        url = self._generate_xunfei_url(api_key, api_secret)
        
        try:
            start_time = datetime.now()
            self.request_count += 1
            
            async with websockets.connect(url) as ws:
                logger.info(f'[{session_id}] 讯飞ASR WebSocket连接成功')
                
                business = {
                    'language': 'zh_cn',
                    'domain': 'iat',
                    'accent': 'mandarin',
                    'vad_eos': 2000,
                    'dwa': 'wpgs'
                }
                
                common = {'app_id': app_id}
                data_header = {
                    'common': common,
                    'business': business,
                    'data': {
                        'status': 0,
                        'format': 'audio/L16;rate=16000',
                        'encoding': 'raw',
                        'audio': ''
                    }
                }
                
                await ws.send(json.dumps(data_header))
                
                async def send_audio():
                    try:
                        status = 1
                        async for chunk in audio_stream:
                            if chunk:
                                audio_b64 = base64.b64encode(chunk).decode('utf-8')
                                frame = {
                                    'data': {
                                        'status': status,
                                        'format': 'audio/L16;rate=16000',
                                        'encoding': 'raw',
                                        'audio': audio_b64
                                    }
                                }
                                await ws.send(json.dumps(frame))
                                status = 1
                        
                        end_frame = {
                            'data': {
                                'status': 2,
                                'format': 'audio/L16;rate=16000',
                                'encoding': 'raw',
                                'audio': ''
                            }
                        }
                        await ws.send(json.dumps(end_frame))
                    
                    except Exception as e:
                        logger.error(f'[{session_id}] 发送音频失败: {e}')
                
                send_task = asyncio.create_task(send_audio())
                
                try:
                    while True:
                        response = await asyncio.wait_for(ws.recv(), timeout=30)
                        data = json.loads(response)
                        
                        code = data.get('code')
                        if code != 0:
                            self.error_count += 1
                            logger.error(f'[{session_id}] 讯飞ASR错误: {data.get("message")}')
                            break
                        
                        result_data = data.get('data', {})
                        result = result_data.get('result', {})
                        
                        if result:
                            ws_list = result.get('ws', [])
                            text_parts = []
                            for ws_item in ws_list:
                                for cw in ws_item.get('cw', []):
                                    text_parts.append(cw.get('w', ''))
                            
                            text = ''.join(text_parts)
                            if text:
                                duration = (datetime.now() - start_time).total_seconds()
                                logger.info(f'[{session_id}] 讯飞ASR识别: {text}, 耗时{duration:.2f}秒')
                                yield text
                        
                        if result_data.get('status') == 2:
                            break
                
                except asyncio.TimeoutError:
                    logger.warning(f'[{session_id}] 讯飞ASR接收超时')
                finally:
                    send_task.cancel()
        
        except Exception as e:
            self.error_count += 1
            logger.error(f'[{session_id}] 讯飞ASR异常: {e}')
            yield ''
    
    def _generate_xunfei_url(self, api_key: str, api_secret: str) -> str:
        host = 'iat-api.xfyun.cn'
        path = '/v2/iat'
        
        now = datetime.utcnow()
        date = now.strftime('%a, %d %b %Y %H:%M:%S GMT')
        
        signature_origin = f'host: {host}\ndate: {date}\nGET {path} HTTP/1.1'
        signature_sha = hmac.new(
            api_secret.encode('utf-8'),
            signature_origin.encode('utf-8'),
            digestmod=hashlib.sha256
        ).digest()
        signature = base64.b64encode(signature_sha).decode('utf-8')
        
        authorization_origin = f'api_key="{api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature}"'
        authorization = base64.b64encode(authorization_origin.encode('utf-8')).decode('utf-8')
        
        params = {
            'host': host,
            'date': date,
            'authorization': authorization
        }
        
        return f'wss://{host}{path}?{urlencode(params)}'
    
    async def recognize(self, audio_data: bytes, session_id: str = '') -> Optional[str]:
        if not audio_data:
            return None
        
        async def audio_generator():
            chunk_size = 3200
            for i in range(0, len(audio_data), chunk_size):
                yield audio_data[i:i + chunk_size]
                await asyncio.sleep(0.04)
        
        result_text = ''
        try:
            async for text in self.recognize_stream(audio_generator(), session_id):
                result_text += text
            
            if result_text:
                logger.info(f'[{session_id}] ASR识别完成: {len(audio_data)}字节音频 -> {result_text}')
                return result_text
            return None
        
        except Exception as e:
            logger.error(f'[{session_id}] ASR识别失败: {e}')
            return None
    
    def validate_audio(self, audio_data: bytes) -> bool:
        if not audio_data or len(audio_data) == 0:
            return False
        if len(audio_data) > settings.MAX_AUDIO_LENGTH * settings.AUDIO_SAMPLE_RATE * 2:
            logger.warning(f'音频过长: {len(audio_data)}字节')
            return False
        return True
    
    def get_stats(self) -> Dict:
        success_rate = ((self.request_count - self.error_count) / self.request_count * 100) if self.request_count > 0 else 0
        return {
            'provider': self.provider,
            'request_count': self.request_count,
            'error_count': self.error_count,
            'success_rate': round(success_rate, 2)
        }
    
    async def get_supported_languages(self) -> list:
        if self.provider == 'azure':
            return [
                {'code': 'zh-CN', 'name': '中文（普通话）'},
                {'code': 'en-US', 'name': 'English (US)'},
                {'code': 'ja-JP', 'name': '日本語'},
                {'code': 'ko-KR', 'name': '한국어'}
            ]
        elif self.provider == 'xunfei':
            return [
                {'code': 'zh_cn', 'name': '中文（普通话）'},
                {'code': 'en_us', 'name': 'English'}
            ]
        return []

asr_service = ASRService()