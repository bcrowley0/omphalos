"""Shared async HTTP client + structured logging of every outbound third-party
call and its outcome (CLAUDE.md conventions).

Adapters use `get_json` / `get_text` so logging, timeouts, and error→exception
mapping live in one place. TLS verification is on by default; the IBKR adapter
constructs its own client with verification disabled for the localhost gateway
ONLY (never globally — hard rule in ibkr.md).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from .adapters.base import RateLimited, SourceUnavailable

logger = logging.getLogger("omphalos.http")

_DEFAULT_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


async def _request(
    method: str,
    url: str,
    *,
    source: str,
    client: httpx.AsyncClient | None = None,
    **kwargs: Any,
) -> httpx.Response:
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT)
    started = time.monotonic()
    try:
        resp = await client.request(method, url, **kwargs)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "outbound source=%s method=%s url=%s status=%s ms=%d",
            source, method, url, resp.status_code, elapsed_ms,
        )
        if resp.status_code == 429:
            raise RateLimited(f"{source} rate-limited (HTTP 429)")
        return resp
    except httpx.HTTPError as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.warning(
            "outbound source=%s method=%s url=%s FAILED err=%s ms=%d",
            source, method, url, exc.__class__.__name__, elapsed_ms,
        )
        raise SourceUnavailable(f"{source} unreachable: {exc.__class__.__name__}") from exc
    finally:
        if own_client:
            await client.aclose()


async def get_json(
    url: str, *, source: str, client: httpx.AsyncClient | None = None, **kwargs: Any
) -> Any:
    resp = await _request("GET", url, source=source, client=client, **kwargs)
    resp.raise_for_status()
    return resp.json()


async def get_text(
    url: str, *, source: str, client: httpx.AsyncClient | None = None, **kwargs: Any
) -> str:
    resp = await _request("GET", url, source=source, client=client, **kwargs)
    resp.raise_for_status()
    return resp.text


async def post_form(
    url: str,
    *,
    source: str,
    data: dict[str, Any],
    headers: dict[str, str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> Any:
    resp = await _request("POST", url, source=source, client=client, data=data, headers=headers or {})
    resp.raise_for_status()
    return resp.json()
