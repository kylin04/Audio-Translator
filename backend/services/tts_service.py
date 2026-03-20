import logging
import asyncio
from typing import AsyncGenerator, Optional
import aiohttp
from datetime import datetime
from config.settings import settings
from utils.cache import translation_cache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TTSService:
    def __init__(self):
        self.config = settings.get_tts_config()
        self.provider = self.config.get('provider', 'azure')
        self.session = None
        self.is_initialized = False
        logger.info(f'TTS服务初始化: {self.provider}')
    
    async def initialize(self):
        if self.is_initialized:
            return
        try:
            self.session = aiohttp.ClientSession()
            self.is_initialized = True
            logger.info('TTS服务初始化成功')
        except Exception as e:
            logger.error(f'TTS服务初始化失败: {e}')
    
    async def close(self):
        if self.session:
            await self.session.close()
            self.is_initialized = False
            logger.info('TTS服务已关闭')
    
    async def synthesize_stream(self, text: str, session_id: str) -> AsyncGenerator[bytes, None]:
        if not self.is_initialized:
            await self.initialize()
        
        if self.provider == 'azure':
            async for audio_chunk in self._azure_tts_stream(text, session_id):
                yield audio_chunk
        else:
            logger.warning(f'不支持的TTS提供商: {self.provider}')
            yield b''
    
    async def _azure_tts_stream(self, text: str, session_id: str) -> AsyncGenerator[bytes, None]:
        api_key = self.config.get('key')
        region = self.config.get('region')
        voice = self.config.get('voice', 'en-US-JennyNeural')
        
        if not api_key or not region:
            logger.error('Azure TTS配置不完整')
            yield b''
            return
        
        url = f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1'
        headers = {
            'Ocp-Apim-Subscription-Key': api_key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
            'User-Agent': 'RealTimeTranslation'
        }
        
        ssml = f'''<speak version='1.0' xml:lang='en-US'>
            <voice xml:lang='en-US' name='{voice}'>
                {text}
            </voice>
        </speak>'''
        
        try:
            start_time = datetime.now()
            async with self.session.post(url, headers=headers, data=ssml.encode('utf-8')) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f'Azure TTS请求失败: {response.status} - {error_text}')
                    yield b''
                    return
                
                chunk_count = 0
                async for chunk in response.content.iter_chunked(4096):
                    if chunk:
                        chunk_count += 1
                        yield chunk
                
                duration = (datetime.now() - start_time).total_seconds()
                logger.info(f'[{session_id}] TTS合成完成: {len(text)}字符, {chunk_count}块, 耗时{duration:.2f}秒')
        
        except asyncio.TimeoutError:
            logger.error(f'[{session_id}] Azure TTS请求超时')
            yield b''
        except Exception as e:
            logger.error(f'[{session_id}] Azure TTS合成异常: {e}')
            yield b''
    
    async def synthesize(self, text: str, session_id: str) -> Optional[bytes]:
        if not text or not text.strip():
            return None
        
        audio_data = b''
        try:
            async for chunk in self.synthesize_stream(text, session_id):
                audio_data += chunk
            
            if audio_data:
                logger.info(f'[{session_id}] TTS合成完整音频: {len(audio_data)}字节')
                return audio_data
            return None
        except Exception as e:
            logger.error(f'[{session_id}] TTS合成失败: {e}')
            return None
    
    def validate_text(self, text: str) -> bool:
        if not text or len(text.strip()) == 0:
            return False
        if len(text) > 5000:
            logger.warning(f'文本过长: {len(text)}字符')
            return False
        return True
    
    async def get_available_voices(self) -> list:
        if self.provider == 'azure':
            return await self._get_azure_voices()
        return []
    
    async def _get_azure_voices(self) -> list:
        api_key = self.config.get('key')
        region = self.config.get('region')
        
        if not api_key or not region:
            return []
        
        url = f'https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list'
        headers = {'Ocp-Apim-Subscription-Key': api_key}
        
        try:
            async with self.session.get(url, headers=headers) as response:
                if response.status == 200:
                    voices = await response.json()
                    return [{'name': v['ShortName'], 'locale': v['Locale']} for v in voices]
        except Exception as e:
            logger.error(f'获取可用语音列表失败: {e}')
        return []

tts_service = TTSService()