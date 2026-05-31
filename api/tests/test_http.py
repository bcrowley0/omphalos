"""http.py is the single outbound choke point: every non-2xx response must map to
a canonical adapter exception so a raw httpx error never reaches a router and gets
mislabelled "Unexpected source error" (CLAUDE.md rule #6)."""

import httpx
import pytest

from app.adapters.base import RateLimited, SourceUnavailable, Unauthenticated
from app.http import get_json, post_form


def _client(status: int, json: object | None = None) -> httpx.AsyncClient:
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={} if json is None else json)

    return httpx.AsyncClient(base_url="https://x.local", transport=httpx.MockTransport(handler))


async def test_401_maps_to_unauthenticated():
    with pytest.raises(Unauthenticated):
        await get_json("/x", source="ibkr", client=_client(401))


async def test_403_maps_to_unauthenticated():
    with pytest.raises(Unauthenticated):
        await get_json("/x", source="ibkr", client=_client(403))


async def test_429_maps_to_rate_limited():
    with pytest.raises(RateLimited):
        await get_json("/x", source="ibkr", client=_client(429))


async def test_500_maps_to_source_unavailable():
    with pytest.raises(SourceUnavailable):
        await get_json("/x", source="ibkr", client=_client(500))


async def test_connect_error_maps_to_source_unavailable():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=req)

    client = httpx.AsyncClient(base_url="https://x.local", transport=httpx.MockTransport(handler))
    with pytest.raises(SourceUnavailable):
        await get_json("/x", source="ibkr", client=client)


async def test_2xx_returns_parsed_json():
    assert await get_json("/x", source="ibkr", client=_client(200, json={"ok": True})) == {"ok": True}


async def test_post_form_401_maps_to_unauthenticated():
    with pytest.raises(Unauthenticated):
        await post_form("/tickle", source="ibkr", data={}, client=_client(401))
