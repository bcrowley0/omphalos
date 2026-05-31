"""Exercise the IBKR session state machine + snapshot flow against a simulated
gateway (httpx.MockTransport) — verifies the three required states and the
first-snapshot-empty retry without needing a real CP Gateway.
"""

import httpx
import pytest

from app.adapters.base import SourceUnavailable, Unauthenticated
from app.adapters.ibkr import IbkrAdapter


def _adapter(handler) -> IbkrAdapter:
    a = IbkrAdapter()
    a._client = httpx.AsyncClient(base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler))
    return a


async def test_gateway_unreachable_maps_to_source_unavailable():
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=req)

    with pytest.raises(SourceUnavailable):
        await _adapter(handler)._ensure_session()


async def test_up_but_not_logged_in_maps_to_unauthenticated():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": False}}})

    with pytest.raises(Unauthenticated):
        await _adapter(handler)._ensure_session()


async def test_tickle_401_maps_to_unauthenticated():
    # An unauthenticated gateway answers /tickle with 401 (it proxies the call
    # upstream). That must surface as the "log in at the gateway" state, never a
    # raw httpx error that the router mislabels "Unexpected source error".
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="unauthorized")

    with pytest.raises(Unauthenticated):
        await _adapter(handler)._ensure_session()


async def test_authenticated_session_passes():
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}})

    await _adapter(handler)._ensure_session()  # must not raise


async def test_get_quote_resolves_conid_and_retries_first_empty_snapshot():
    state = {"snapshot_calls": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/tickle"):
            return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}})
        if path.endswith("/iserver/accounts"):
            return httpx.Response(200, json=[{"accountId": "U123"}])
        if path.endswith("/iserver/secdef/search"):
            return httpx.Response(200, json=[
                {"conid": 265598, "description": "NASDAQ", "sections": [{"secType": "STK"}]},
            ])
        if path.endswith("/iserver/marketdata/snapshot"):
            state["snapshot_calls"] += 1
            if state["snapshot_calls"] == 1:
                return httpx.Response(200, json=[{}])  # first call empty -> retry
            return httpx.Response(200, json=[{"31": "241.17", "84": "241.05", "86": "241.29"}])
        return httpx.Response(404)

    q = await _adapter(handler).get_quote("AAPL")
    assert state["snapshot_calls"] >= 2  # retried past the empty first response
    assert q.last == 241.17
    assert q.bid == 241.05
    assert q.source == "ibkr"
    assert q.stale is False
