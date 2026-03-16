"""
Simple in-memory application-level cache for processed telemetry responses.
FastF1 has its own disk cache for raw API data. This caches processed results.
"""
import time
from typing import Any, Optional

_cache: dict = {}
_ttl: dict = {}

# Cache entries expire after 24 hours (sessions don't change after completion)
CACHE_TTL_SECONDS = 86400


def make_key(*args) -> str:
    return ":".join(str(a) for a in args)


def get(key: str) -> Optional[Any]:
    if key not in _cache:
        return None
    if time.time() > _ttl.get(key, 0):
        del _cache[key]
        del _ttl[key]
        return None
    return _cache[key]


def set(key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
    _cache[key] = value
    _ttl[key] = time.time() + ttl


def clear() -> None:
    _cache.clear()
    _ttl.clear()
