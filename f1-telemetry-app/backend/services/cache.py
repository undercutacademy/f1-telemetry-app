"""
Two-layer cache:
  1. In-memory  — fast, lost on restart
  2. Upstash Redis REST — persistent across restarts, survives Render cold starts

All existing cache.get() / cache.set() calls use both layers automatically.
Redis is optional: if env vars are missing the service falls back to in-memory only.
"""
import json
import time
import os
import httpx
from typing import Any, Optional

# ─── In-memory layer ──────────────────────────────────────────────────────────

_cache: dict = {}
_ttl: dict = {}

CACHE_TTL_SECONDS = 86400  # 24 hours


def make_key(*args) -> str:
    return ":".join(str(a) for a in args)


# ─── Redis layer (Upstash REST API) ───────────────────────────────────────────

_UPSTASH_URL = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
_UPSTASH_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")


def _redis_available() -> bool:
    return bool(_UPSTASH_URL and _UPSTASH_TOKEN)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_UPSTASH_TOKEN}",
        "Content-Type": "application/json",
    }


def _redis_get(key: str) -> Optional[Any]:
    if not _redis_available():
        return None
    try:
        r = httpx.post(
            _UPSTASH_URL,
            headers=_headers(),
            content=json.dumps(["GET", key]),
            timeout=5.0,
        )
        result = r.json().get("result")
        if result:
            return json.loads(result)
    except Exception:
        pass
    return None


def _redis_set(key: str, value: Any, ttl: int) -> None:
    if not _redis_available():
        return
    try:
        payload = json.dumps(value, default=str)
        httpx.post(
            _UPSTASH_URL,
            headers=_headers(),
            content=json.dumps(["SET", key, payload, "EX", str(ttl)]),
            timeout=10.0,
        )
    except Exception:
        pass


# ─── Public API ───────────────────────────────────────────────────────────────

def get(key: str) -> Optional[Any]:
    # 1. In-memory hit
    if key in _cache:
        if time.time() <= _ttl.get(key, 0):
            return _cache[key]
        _cache.pop(key, None)
        _ttl.pop(key, None)

    # 2. Redis hit — also warms in-memory for subsequent requests
    value = _redis_get(key)
    if value is not None:
        _cache[key] = value
        _ttl[key] = time.time() + CACHE_TTL_SECONDS
        return value

    return None


def set(key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
    _cache[key] = value
    _ttl[key] = time.time() + ttl
    _redis_set(key, value, ttl)


def clear() -> None:
    """Clears only the in-memory layer. Redis is intentionally kept intact
    so cached F1 sessions survive server restarts."""
    _cache.clear()
    _ttl.clear()
