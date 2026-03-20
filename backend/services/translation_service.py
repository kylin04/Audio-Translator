import logging
import asyncio
from typing import Optional, Dict
import aiohttp
from datetime import datetime
from config.settings import settings
from utils.cache import translation_cache

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TranslationService:
    def __init__(self):
        self.config = settings.get_translation_config()
        self.provider = self.config.get('provider', 'deepl')
        self.session = None
        self.is_initialized = False
        self.request_count = 0
        self.error_count = 0
        logger.info(f'翻译服务初始化: {self.provider}')
    
    async def initialize(self):
        if self.is_initialized:
            return
        try:
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            self.session = aiohttp.ClientSession(timeout=timeout)
            self.is_initialized = True
            logger.info('翻译服务初始化成功')
        except Exception as e:
            logger.error(f'翻译服务初始化失败: {e}')
    
    async def close(self):
        if self.session:
            await self.session.close()
            self.is_initialized = False
            logger.info('翻译服务已关闭')
    
    async def translate(self, text: str, source_lang: str = None, target_lang: str = None, session_id: str = '') -> Optional[str]:
        if not text or not text.strip():
            return None
        
        if not self.is_initialized:
            await self.initialize()
        
        source_lang = source_lang or self.config.get('source_lang', 'zh')
        target_lang = target_lang or self.config.get('target_lang', 'en')
        
        cached_translation = translation_cache.get_translation(text, source_lang, target_lang)
        if cached_translation:
            logger.info(f'[{session_id}] 翻译缓存命中: {text[:50]}...')
            return cached_translation
        
        if self.provider == 'deepl':
            translation = await self._translate_deepl(text, source_lang, target_lang, session_id)
        else:
            logger.warning(f'不支持的翻译提供商: {self.provider}')
            translation = None
        
        if translation:
            translation_cache.put_translation(text, source_lang, target_lang, translation)
        
        return translation
    
    async def _translate_deepl(self, text: str, source_lang: str, target_lang: str, session_id: str) -> Optional[str]:
        api_key = self.config.get('api_key')
        
        if not api_key:
            logger.error('DeepL API Key未配置')
            return None
        
        url = 'https://api-free.deepl.com/v2/translate'
        
        lang_map = {
            'zh': 'ZH',
            'en': 'EN',
            'ja': 'JA',
            'ko': 'KO',
            'fr': 'FR',
            'de': 'DE',
            'es': 'ES',
            'ru': 'RU'
        }
        
        source_lang_code = lang_map.get(source_lang.lower(), 'ZH')
        target_lang_code = lang_map.get(target_lang.lower(), 'EN')
        
        headers = {
            'Authorization': f'DeepL-Auth-Key {api_key}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'text': [text],
            'source_lang': source_lang_code,
            'target_lang': target_lang_code
        }
        
        try:
            start_time = datetime.now()
            self.request_count += 1
            
            async with self.session.post(url, json=payload, headers=headers) as response:
                if response.status == 200:
                    result = await response.json()
                    translation = result['translations'][0]['text']
                    duration = (datetime.now() - start_time).total_seconds()
                    logger.info(f'[{session_id}] DeepL翻译成功: {len(text)}字符, 耗时{duration:.2f}秒')
                    return translation
                else:
                    error_text = await response.text()
                    self.error_count += 1
                    logger.error(f'[{session_id}] DeepL翻译失败: {response.status} - {error_text}')
                    return None
        
        except asyncio.TimeoutError:
            self.error_count += 1
            logger.error(f'[{session_id}] DeepL翻译请求超时')
            return None
        except Exception as e:
            self.error_count += 1
            logger.error(f'[{session_id}] DeepL翻译异常: {e}')
            return None
    
    async def translate_batch(self, texts: list, source_lang: str = None, target_lang: str = None, session_id: str = '') -> list:
        if not texts:
            return []
        
        tasks = [self.translate(text, source_lang, target_lang, session_id) for text in texts]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        translations = []
        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f'[{session_id}] 批量翻译第{idx+1}项失败: {result}')
                translations.append(None)
            else:
                translations.append(result)
        
        return translations
    
    def validate_text(self, text: str) -> bool:
        if not text or len(text.strip()) == 0:
            return False
        if len(text) > 5000:
            logger.warning(f'文本过长: {len(text)}字符')
            return False
        return True
    
    async def detect_language(self, text: str) -> Optional[str]:
        if not text or not text.strip():
            return None
        
        chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        total_chars = len(text)
        
        if chinese_chars / total_chars > 0.3:
            return 'zh'
        return 'en'
    
    def get_stats(self) -> Dict:
        success_rate = ((self.request_count - self.error_count) / self.request_count * 100) if self.request_count > 0 else 0
        return {
            'provider': self.provider,
            'request_count': self.request_count,
            'error_count': self.error_count,
            'success_rate': round(success_rate, 2),
            'cache_stats': translation_cache.get_stats()
        }
    
    async def get_supported_languages(self) -> list:
        if self.provider == 'deepl':
            return [
                {'code': 'zh', 'name': '中文'},
                {'code': 'en', 'name': 'English'},
                {'code': 'ja', 'name': '日本語'},
                {'code': 'ko', 'name': '한국어'},
                {'code': 'fr', 'name': 'Français'},
                {'code': 'de', 'name': 'Deutsch'},
                {'code': 'es', 'name': 'Español'},
                {'code': 'ru', 'name': 'Русский'}
            ]
        return []

translation_service = TranslationService()