"""Adapter registry (CLAUDE.md hard rule #3).

A simple name -> adapter-instance map. A broken or missing source must never
crash the app: callers look up by name and handle a missing adapter as a
graceful state.
"""

from __future__ import annotations

from .base import Adapter


class AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: dict[str, Adapter] = {}

    def register(self, adapter: Adapter) -> None:
        self._adapters[adapter.name] = adapter

    def get(self, name: str) -> Adapter | None:
        return self._adapters.get(name)

    def names(self) -> list[str]:
        return sorted(self._adapters)


#: process-wide registry, populated at import time in app.deps
registry = AdapterRegistry()
