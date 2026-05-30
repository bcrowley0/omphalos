"""Tiny in-memory TTL cache (CLAUDE.md: short-TTL cache for FRED/Kraken/RSS to
avoid rate limits). Process-local; no external store. Thread-safe enough for the
single-process dev server via a lock.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Awaitable


class TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        now = time.monotonic()
        with self._lock:
            hit = self._store.get(key)
            if hit is None:
                return None
            expires_at, value = hit
            if expires_at < now:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        with self._lock:
            self._store[key] = (time.monotonic() + ttl_seconds, value)

    async def get_or_set(
        self, key: str, ttl_seconds: float, producer: Callable[[], Awaitable[Any]]
    ) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached
        value = await producer()
        self.set(key, value, ttl_seconds)
        return value


#: process-wide cache shared by adapters
cache = TTLCache()
