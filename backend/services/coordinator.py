import logging
import asyncio
from typing import AsyncGenerator, Optional, Dict, Callable
from datetime import datetime
from collections import defaultdict
from services.asr_service import asr_service
from services.translation_service import translation_service
from services.tts_service import tts_service
from config.settings import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class StreamCoordinator:
    def __init__(self):
        self.active_sessions = {}
        self.session_stats = defaultdict(lambda: {
            'start_time': None,
            'audio_chunks': 0,
            'asr_results': 0,
            'translations': 0,
            'tts_results': 0,
            'errors': 0
        })
        self.is_initialized = False
        logger.info('流式处理协调器初始化')
    
    async def initialize(self):
        if self.is_initialized:
            return
        try:
            await asr_service.initialize()
            await translation_service.initialize()
            await tts_service.initialize()
            self.is_initialized = True
            logger.info('协调器所有服务初始化完成')
        except Exception as e:
            logger.error(f'协调器初始化失败: {e}')
            raise
    
    async def close(self):
        try:
            await asr_service.close()
            await translation_service.close()
            await tts_service.close()
            self.is_initialized = False
            logger.info('协调器所有服务已关闭')
        except Exception as e:
            logger.error(f'协调器关闭失败: {e}')
    
    async def process_stream(
        self,
        audio_stream: AsyncGenerator[bytes, None],
        session_id: str,
        source_lang: str = None,
        target_lang: str = None,
        callback: Optional[Callable] = None
    ) -> AsyncGenerator[Dict, None]:
        if not self.is_initialized:
            await self.initialize()
        
        source_lang = source_lang or settings.SOURCE_LANGUAGE[:2]
        target_lang = target_lang or settings.TARGET_LANGUAGE[:2]
        
        self.active_sessions[session_id] = True
        self.session_stats[session_id]['start_time'] = datetime.now()
        
        logger.info(f'[{session_id}] 开始流式处理: {source_lang} -> {target_lang}')
        
        try:
            asr_buffer = []
            translation_queue = asyncio.Queue()
            tts_queue = asyncio.Queue()
            
            async def asr_task():
                try:
                    async for text in asr_service.recognize_stream(audio_stream, session_id):
                        if text and text.strip():
                            self.session_stats[session_id]['asr_results'] += 1
                            asr_buffer.append(text)
                            await translation_queue.put(text)
                            
                            if callback:
                                await callback({
                                    'type': 'asr',
                                    'session_id': session_id,
                                    'text': text,
                                    'timestamp': datetime.now().isoformat()
                                })
                    
                    await translation_queue.put(None)
                except asyncio.CancelledError:
                    logger.info(f'[{session_id}] ASR任务被取消')
                    await translation_queue.put(None)
                    raise
                except Exception as e:
                    self.session_stats[session_id]['errors'] += 1
                    logger.error(f'[{session_id}] ASR任务异常: {e}')
                    await translation_queue.put(None)
                finally:
                    logger.debug(f'[{session_id}] ASR任务结束')
            
            async def translation_task():
                try:
                    while True:
                        text = await translation_queue.get()
                        translation_queue.task_done()
                        
                        if text is None:
                            await tts_queue.put(None)
                            break
                        
                        translation = await translation_service.translate(
                            text, source_lang, target_lang, session_id
                        )
                        
                        if translation:
                            self.session_stats[session_id]['translations'] += 1
                            await tts_queue.put({
                                'original': text,
                                'translated': translation
                            })
                            
                            if callback:
                                await callback({
                                    'type': 'translation',
                                    'session_id': session_id,
                                    'original_text': text,
                                    'translated_text': translation,
                                    'timestamp': datetime.now().isoformat()
                                })
                except asyncio.CancelledError:
                    logger.info(f'[{session_id}] 翻译任务被取消')
                    await tts_queue.put(None)
                    raise
                except Exception as e:
                    self.session_stats[session_id]['errors'] += 1
                    logger.error(f'[{session_id}] 翻译任务异常: {e}')
                    await tts_queue.put(None)
                finally:
                    logger.debug(f'[{session_id}] 翻译任务结束')
            
            async def tts_task():
                try:
                    while True:
                        item = await tts_queue.get()
                        tts_queue.task_done()
                        
                        if item is None:
                            break
                        
                        translated_text = item['translated']
                        audio_chunks = []
                        
                        async for audio_chunk in tts_service.synthesize_stream(translated_text, session_id):
                            if audio_chunk:
                                audio_chunks.append(audio_chunk)
                        
                        if audio_chunks:
                            self.session_stats[session_id]['tts_results'] += 1
                            audio_data = b''.join(audio_chunks)
                            
                            yield {
                                'type': 'tts',
                                'session_id': session_id,
                                'original_text': item['original'],
                                'translated_text': translated_text,
                                'audio_data': audio_data,
                                'timestamp': datetime.now().isoformat()
                            }
                            
                            if callback:
                                await callback({
                                    'type': 'tts',
                                    'session_id': session_id,
                                    'audio_size': len(audio_data),
                                    'timestamp': datetime.now().isoformat()
                                })
                except asyncio.CancelledError:
                    logger.info(f'[{session_id}] TTS任务被取消')
                    raise
                except Exception as e:
                    self.session_stats[session_id]['errors'] += 1
                    logger.error(f'[{session_id}] TTS任务异常: {e}')
                finally:
                    logger.debug(f'[{session_id}] TTS任务结束')
            
            asr_task_handle = asyncio.create_task(asr_task())
            translation_task_handle = asyncio.create_task(translation_task())
            
            try:
                async for result in tts_task():
                    yield result
            except asyncio.CancelledError:
                logger.info(f'[{session_id}] 流式处理被取消')
                asr_task_handle.cancel()
                translation_task_handle.cancel()
                raise
            finally:
                await asyncio.gather(asr_task_handle, translation_task_handle, return_exceptions=True)
                
                while not translation_queue.empty():
                    try:
                        translation_queue.get_nowait()
                        translation_queue.task_done()
                    except asyncio.QueueEmpty:
                        break
                
                while not tts_queue.empty():
                    try:
                        tts_queue.get_nowait()
                        tts_queue.task_done()
                    except asyncio.QueueEmpty:
                        break
            
            duration = (datetime.now() - self.session_stats[session_id]['start_time']).total_seconds()
            stats = self.session_stats[session_id]
            logger.info(
                f'[{session_id}] 流式处理完成: '
                f'ASR={stats["asr_results"]}, '
                f'翻译={stats["translations"]}, '
                f'TTS={stats["tts_results"]}, '
                f'错误={stats["errors"]}, '
                f'耗时={duration:.2f}秒'
            )
        
        except Exception as e:
            self.session_stats[session_id]['errors'] += 1
            logger.error(f'[{session_id}] 协调器处理异常: {e}')
            yield {
                'type': 'error',
                'session_id': session_id,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
        
        finally:
            self.active_sessions.pop(session_id, None)
    
    async def process_audio_chunk(
        self,
        audio_chunk: bytes,
        session_id: str,
        source_lang: str = None,
        target_lang: str = None
    ) -> Optional[Dict]:
        if not audio_chunk:
            return None
        
        self.session_stats[session_id]['audio_chunks'] += 1
        
        try:
            async def chunk_generator():
                yield audio_chunk
            
            async for result in self.process_stream(
                chunk_generator(),
                session_id,
                source_lang,
                target_lang
            ):
                return result
        
        except Exception as e:
            logger.error(f'[{session_id}] 音频块处理失败: {e}')
            return None
    
    def get_session_stats(self, session_id: str) -> Dict:
        if session_id not in self.session_stats:
            return {}
        
        stats = self.session_stats[session_id].copy()
        if stats['start_time']:
            stats['duration'] = (datetime.now() - stats['start_time']).total_seconds()
        else:
            stats['duration'] = 0
        stats['start_time'] = stats['start_time'].isoformat() if stats['start_time'] else None
        
        return stats
    
    def get_all_sessions(self) -> Dict:
        return {
            'active_count': len(self.active_sessions),
            'total_sessions': len(self.session_stats),
            'sessions': {
                sid: self.get_session_stats(sid)
                for sid in self.session_stats.keys()
            }
        }
    
    def clear_session(self, session_id: str) -> bool:
        if session_id in self.active_sessions:
            self.active_sessions.pop(session_id)
        if session_id in self.session_stats:
            self.session_stats.pop(session_id)
            logger.info(f'[{session_id}] 会话数据已清除')
            return True
        return False
    
    async def validate_services(self) -> Dict:
        results = {
            'asr': False,
            'translation': False,
            'tts': False
        }
        
        try:
            test_text = '测试'
            test_session = 'validation'
            
            asr_languages = await asr_service.get_supported_languages()
            results['asr'] = len(asr_languages) > 0
            
            translation = await translation_service.translate(test_text, 'zh', 'en', test_session)
            results['translation'] = translation is not None
            
            tts_voices = await tts_service.get_available_voices()
            results['tts'] = len(tts_voices) > 0
            
        except Exception as e:
            logger.error(f'服务验证失败: {e}')
        
        return results
    
    def get_system_stats(self) -> Dict:
        return {
            'coordinator': {
                'initialized': self.is_initialized,
                'active_sessions': len(self.active_sessions)
            },
            'asr': asr_service.get_stats(),
            'translation': translation_service.get_stats(),
            'cache': translation_service.get_stats().get('cache_stats', {})
        }

coordinator = StreamCoordinator()