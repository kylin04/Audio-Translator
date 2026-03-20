import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Settings:
    def __init__(self):
        self.AZURE_SPEECH_KEY = os.environ.get('AZURE_SPEECH_KEY', '')
        self.AZURE_SPEECH_REGION = os.environ.get('AZURE_SPEECH_REGION', 'eastasia')
        self.XUNFEI_APP_ID = os.environ.get('XUNFEI_APP_ID', '')
        self.XUNFEI_API_KEY = os.environ.get('XUNFEI_API_KEY', '')
        self.XUNFEI_API_SECRET = os.environ.get('XUNFEI_API_SECRET', '')
        self.DEEPL_API_KEY = os.environ.get('DEEPL_API_KEY', '')
        self.DATABASE_NAME = os.environ.get('DATABASE_NAME', 'translation_cache')
        self.CACHE_SIZE = int(os.environ.get('CACHE_SIZE', '1000'))
        self.AUDIO_SAMPLE_RATE = 16000
        self.OPUS_BITRATE = 24000
        self.CHUNK_DURATION_MS = 200
        self.WEBSOCKET_TIMEOUT = 300
        self.MAX_AUDIO_LENGTH = 60
        self.SOURCE_LANGUAGE = 'zh-CN'
        self.TARGET_LANGUAGE = 'en-US'
        self.TTS_VOICE = 'en-US-JennyNeural'
        self.ASR_PROVIDER = os.environ.get('ASR_PROVIDER', 'azure')
        self.TTS_PROVIDER = os.environ.get('TTS_PROVIDER', 'azure')
        self.TRANSLATION_PROVIDER = os.environ.get('TRANSLATION_PROVIDER', 'deepl')
        self._validate_config()
    
    def _validate_config(self):
        if self.ASR_PROVIDER == 'azure' and not self.AZURE_SPEECH_KEY:
            logger.warning('Azure Speech Key未配置，ASR功能可能无法使用')
        if self.ASR_PROVIDER == 'xunfei' and not all([self.XUNFEI_APP_ID, self.XUNFEI_API_KEY]):
            logger.warning('讯飞API配置不完整，ASR功能可能无法使用')
        if self.TRANSLATION_PROVIDER == 'deepl' and not self.DEEPL_API_KEY:
            logger.warning('DeepL API Key未配置，翻译功能可能无法使用')
        if self.TTS_PROVIDER == 'azure' and not self.AZURE_SPEECH_KEY:
            logger.warning('Azure Speech Key未配置，TTS功能可能无法使用')
    
    def get_asr_config(self):
        if self.ASR_PROVIDER == 'azure':
            return {
                'provider': 'azure',
                'key': self.AZURE_SPEECH_KEY,
                'region': self.AZURE_SPEECH_REGION,
                'language': self.SOURCE_LANGUAGE
            }
        elif self.ASR_PROVIDER == 'xunfei':
            return {
                'provider': 'xunfei',
                'app_id': self.XUNFEI_APP_ID,
                'api_key': self.XUNFEI_API_KEY,
                'api_secret': self.XUNFEI_API_SECRET,
                'language': self.SOURCE_LANGUAGE
            }
        return {}
    
    def get_translation_config(self):
        return {
            'provider': self.TRANSLATION_PROVIDER,
            'api_key': self.DEEPL_API_KEY,
            'source_lang': self.SOURCE_LANGUAGE[:2],
            'target_lang': self.TARGET_LANGUAGE[:2]
        }
    
    def get_tts_config(self):
        return {
            'provider': self.TTS_PROVIDER,
            'key': self.AZURE_SPEECH_KEY,
            'region': self.AZURE_SPEECH_REGION,
            'voice': self.TTS_VOICE,
            'language': self.TARGET_LANGUAGE
        }

settings = Settings()