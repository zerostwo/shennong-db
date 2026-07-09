import asyncio
import json
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

import orjson

try:
    from redis.exceptions import RedisError
except ImportError:  # pragma: no cover - only used when optional runtime deps are absent.

    class RedisError(Exception):
        pass


class AsyncQueryCache:
    async def get(self, key: str) -> dict[str, Any] | None:
        raise NotImplementedError

    async def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        raise NotImplementedError

    async def close(self) -> None:
        return None

    async def get_or_set(
        self,
        key: str,
        ttl_seconds: int,
        producer: Callable[[], Awaitable[dict[str, Any]]],
    ) -> tuple[dict[str, Any], bool]:
        cached = await self.get(key)
        if cached is not None:
            return cached, True
        value = await producer()
        await self.set(key, value, ttl_seconds)
        return value, False


class InMemoryTTLCache(AsyncQueryCache):
    """Small process-local fallback cache for tests and single-process local runs."""

    def __init__(self, max_items: int = 2048) -> None:
        self.max_items = max_items
        self._items: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> dict[str, Any] | None:
        async with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= time.monotonic():
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return value

    async def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        async with self._lock:
            self._items[key] = (time.monotonic() + ttl_seconds, value)
            self._items.move_to_end(key)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)


class RedisQueryCache(AsyncQueryCache):
    def __init__(self, redis_url: str) -> None:
        from redis.asyncio import from_url

        self._redis = from_url(redis_url, decode_responses=False)

    async def get(self, key: str) -> dict[str, Any] | None:
        try:
            raw = await self._redis.get(key)
        except RedisError:
            return None
        if raw is None:
            return None
        return json.loads(raw)

    async def set(self, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
        try:
            await self._redis.set(key, orjson.dumps(value), ex=ttl_seconds)
        except RedisError:
            return None

    async def close(self) -> None:
        try:
            await self._redis.aclose()
        except RedisError:
            return None


def stable_cache_key(namespace: str, payload: Any) -> str:
    raw = orjson.dumps(payload, option=orjson.OPT_SORT_KEYS | orjson.OPT_NON_STR_KEYS)
    return f"{namespace}:{raw.hex()}"
