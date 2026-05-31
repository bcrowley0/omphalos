"""End-to-end router tests for chart span/interval params (TestClient)."""

import httpx
from fastapi.testclient import TestClient

from app.deps import get_registry
from app.main import app

client = TestClient(app)


def test_chart_rejects_unknown_interval():
    r = client.get("/chart", params={"symbol": "AAPL", "interval": "bogus"})
    assert r.status_code == 422


def test_chart_rejects_unknown_span():
    r = client.get("/chart", params={"symbol": "AAPL", "span": "10Y"})
    assert r.status_code == 422


def _mock_ibkr_gateway() -> httpx.AsyncClient:
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/tickle"):
            return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}})
        if path.endswith("/iserver/accounts"):
            return httpx.Response(200, json=[{"id": "DU1"}])
        if path.endswith("/iserver/secdef/search"):
            return httpx.Response(
                200, json=[{"conid": 1, "description": "NASDAQ", "sections": [{"secType": "STK"}]}]
            )
        if path.endswith("/iserver/marketdata/history"):
            return httpx.Response(
                200, json={"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 9}]}
            )
        return httpx.Response(404, json={})

    return httpx.AsyncClient(base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler))


def test_chart_echoes_resolved_interval_and_span():
    ibkr = get_registry().get("ibkr")
    ibkr._client = _mock_ibkr_gateway()
    ibkr._conids.clear()
    ibkr._primed = False

    r = client.get("/chart", params={"symbol": "AAPL", "interval": "4h", "span": "1Y"})
    assert r.status_code == 200
    body = r.json()
    assert body["interval"] == "4h"
    assert body["span"] == "1Y"
    assert body["status"] == "ok"
    assert len(body["candles"]) == 1
