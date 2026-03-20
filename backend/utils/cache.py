import logging
from collections import OrderedDict
from threading import Lock
from typing import Optional, Any
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class LRUCache:
    def __init__(self, capacity: int = 1000):
        self.capacity = capacity
        self.cache = OrderedDict()
        self.lock = Lock()
        self.hit_count = 0
        self.miss_count = 0
        logger.info(f'LRU缓存初始化完成，容量: {capacity}')
    
    def get(self, key: str) -> Optional[Any]:
        with self.lock:
            if key not in self.cache:
                self.miss_count += 1
                return None
            self.cache.move_to_end(key)
            self.hit_count += 1
            value, timestamp = self.cache[key]
            logger.debug(f'缓存命中: {key}')
            return value
    
    def put(self, key: str, value: Any) -> None:
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
            self.cache[key] = (value, datetime.now())
            if len(self.cache) > self.capacity:
                oldest_key = next(iter(self.cache))
                removed_value = self.cache.pop(oldest_key)
                logger.debug(f'缓存已满，移除最旧项: {oldest_key}')
    
    def exists(self, key: str) -> bool:
        with self.lock:
            return key in self.cache
    
    def delete(self, key: str) -> bool:
        with self.lock:
            if key in self.cache:
                del self.cache[key]
                logger.debug(f'删除缓存项: {key}')
                return True
            return False
    
    def clear(self) -> None:
        with self.lock:
            self.cache.clear()
            self.hit_count = 0
            self.miss_count = 0
            logger.info('缓存已清空')
    
    def size(self) -> int:
        with self.lock:
            return len(self.cache)
    
    def get_stats(self) -> dict:
        with self.lock:
            total_requests = self.hit_count + self.miss_count
            hit_rate = (self.hit_count / total_requests * 100) if total_requests > 0 else 0
            return {
                'size': len(self.cache),
                'capacity': self.capacity,
                'hit_count': self.hit_count,
                'miss_count': self.miss_count,
                'hit_rate': round(hit_rate, 2)
            }
    
    def get_all_keys(self) -> list:
        with self.lock:
            return list(self.cache.keys())

class TranslationCache(LRUCache):
    def __init__(self, capacity: int = 1000):
        super().__init__(capacity)
        self.phrase_frequency = {}
    
    def get_translation(self, source_text: str, source_lang: str, target_lang: str) -> Optional[str]:
        cache_key = f'{source_lang}:{target_lang}:{source_text}'
        translation = self.get(cache_key)
        if translation:
            self._update_frequency(source_text)
        return translation
    
    def put_translation(self, source_text: str, source_lang: str, target_lang: str, translation: str) -> None:
        cache_key = f'{source_lang}:{target_lang}:{source_text}'
        self.put(cache_key, translation)
        self._update_frequency(source_text)
    
    def _update_frequency(self, text: str) -> None:
        with self.lock:
            self.phrase_frequency[text] = self.phrase_frequency.get(text, 0) + 1
    
    def get_frequent_phrases(self, top_n: int = 10) -> list:
        with self.lock:
            sorted_phrases = sorted(
                self.phrase_frequency.items(),
                key=lambda x: x[1],
                reverse=True
            )
            return sorted_phrases[:top_n]

translation_cache = TranslationCache()