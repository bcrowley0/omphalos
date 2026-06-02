"""Pluggable auth transports for the IBKR adapter.

The adapter's data methods call `get` / `post` / `ensure_session` on a transport,
so the choice between the local Client Portal Gateway and headless OAuth 1.0a is
isolated here. See docs/superpowers/specs/2026-06-02-ibkr-oauth-design.md.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

try:  # ibind is only needed for OAuth mode; keep the gateway path import-safe without it
    from ibind.oauth.oauth1a import generate_oauth_headers, req_live_session_token
except ImportError:  # pragma: no cover
    generate_oauth_headers = None  # type: ignore[assignment]
    req_live_session_token = None  # type: ignore[assignment]

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


class OAuthTransport(IbkrTransport):
    """Headless Web API OAuth 1.0a. ibind performs the auth handshake (live
    session token + request signing); our httpx makes the actual data calls to
    api.ibkr.com. Holds a 24h LST and a brokerage session (ssodh/init)."""

    BASE = "https://api.ibkr.com/v1/api"

    def __init__(self, oauth_config: Any) -> None:
        self._oauth = oauth_config
        self._client: httpx.AsyncClient | None = None
        self._lst: str | None = None
        self._lst_expires_ms: int = 0
        self._brokerage_ready = False

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            # Real (CA-signed) endpoint: keep TLS verification ON.
            self._client = httpx.AsyncClient(
                base_url=self.BASE, timeout=httpx.Timeout(10.0, connect=5.0)
            )
        return self._client

    def _ibind_client(self) -> Any:
        # Minimal ibind client used ONLY to perform the LST handshake.
        from ibind import IbkrClient

        return IbkrClient(use_oauth=True, oauth_config=self._oauth)

    def _headers(self, method: str, path: str, params: dict | None = None) -> dict[str, str]:
        return generate_oauth_headers(
            oauth_config=self._oauth,
            request_method=method,
            request_url=f"{self.BASE}{path}",
            live_session_token=self._lst,
            request_params=params,
            signature_method="HMAC-SHA256",
        )

    async def get(self, path: str, **kwargs: Any) -> Any:
        # params stays in kwargs: it's both signed (OAuth) and forwarded to httpx via get_json.
        params = kwargs.get("params")
        headers = {**self._headers("GET", path, params), **kwargs.pop("headers", {})}
        return await get_json(path, source="ibkr", client=self._http(), headers=headers, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        data = kwargs.pop("data", {})
        headers = {**self._headers("POST", path, data or None), **kwargs.pop("headers", {})}
        assert not kwargs, f"OAuthTransport.post got unexpected kwargs: {kwargs}"
        return await post_form(path, source="ibkr", data=data, client=self._http(), headers=headers)

    def _lst_valid(self) -> bool:
        return bool(self._lst) and self._lst_expires_ms > int(time.time() * 1000) + 60_000

    async def ensure_session(self) -> None:
        if not self._lst_valid():
            try:
                lst, expires_ms, _sig = req_live_session_token(self._ibind_client(), self._oauth)
            except Exception as exc:  # noqa: BLE001 — bad creds/signature => actionable state
                self._brokerage_ready = False
                raise Unauthenticated(
                    "IBKR OAuth credentials were rejected — check api/.env."
                ) from exc
            self._lst = lst
            self._lst_expires_ms = int(expires_ms)
            self._brokerage_ready = False
        if not self._brokerage_ready:
            # Initialize the brokerage session for iserver endpoints, then confirm.
            await self.post("/iserver/auth/ssodh/init", data={"publish": "true", "compete": "true"})
            await self.post("/tickle")
            self._brokerage_ready = True
