"""Pluggable auth transports for the IBKR adapter.

The adapter's data methods call `get` / `post` / `ensure_session` on a transport,
so the choice between the local Client Portal Gateway and headless OAuth 1.0a is
isolated here. See docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md.
"""

from __future__ import annotations

from typing import Any

import httpx

from ..http import get_json, post_form
from .base import SourceUnavailable, Unauthenticated


class IbkrTransport:
    """Base transport. Subclasses own the base URL, the httpx client, request
    auth, and session establishment. `get`/`post` return parsed JSON."""

    async def get(self, path: str, **kwargs: Any) -> Any:  # pragma: no cover
        raise NotImplementedError

    async def post(self, path: str, **kwargs: Any) -> Any:  # pragma: no cover
        raise NotImplementedError

    async def ensure_session(self) -> None:  # pragma: no cover
        raise NotImplementedError


class GatewayTransport(IbkrTransport):
    """Local Client Portal Gateway: self-signed cert (TLS verify OFF for this
    localhost client ONLY), browser-established session kept alive via /tickle."""

    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base, verify=False, timeout=httpx.Timeout(10.0, connect=4.0)
            )
        return self._client

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await get_json(path, source="ibkr", client=self._http(), **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        data = kwargs.pop("data", {})
        return await post_form(path, source="ibkr", data=data, client=self._http(), **kwargs)

    async def ensure_session(self) -> None:
        try:
            data = await self.post("/tickle")
        except Unauthenticated as exc:
            raise Unauthenticated(
                "Log in at the IBKR gateway in your browser, then retry."
            ) from exc
        except SourceUnavailable as exc:
            raise SourceUnavailable(
                "IBKR gateway is not reachable — is the Client Portal Gateway running?"
            ) from exc
        auth = (((data or {}).get("iserver") or {}).get("authStatus") or {}).get("authenticated")
        if auth is None:
            status = await self.get("/iserver/auth/status")
            auth = (status or {}).get("authenticated")
        if not auth:
            raise Unauthenticated("Log in at the IBKR gateway in your browser, then retry.")
