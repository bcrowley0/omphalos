"""End-to-end router tests for chart span/interval params (TestClient)."""

import httpx
from fastapi.testclient import TestClient

from app.deps import get_registry
from app.main import app
from app.models import MarginSummary, Position

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


def test_portfolio_merges_kraken_margin_and_summary(monkeypatch):
    kraken = get_registry().get("kraken")
    ibkr = get_registry().get("ibkr")

    async def _positions():
        return [Position(symbol="AAPL", qty=1, avg_cost=10, market_value=12, unrealized_pnl=2, source="ibkr")]

    async def _balances():
        return []

    async def _open_positions():
        return [Position(symbol="BTC/USD", qty=0.5, avg_cost=40000, market_value=21000,
                         unrealized_pnl=1000, margin_used=4000, side="long", source="kraken")]

    async def _trade_balance():
        return MarginSummary(equity=10000, used_margin=2000, free_margin=8000, margin_level=500,
                             unrealized_pnl=150, cost_basis=1900, valuation=2050)

    monkeypatch.setattr(ibkr, "get_positions", _positions)
    monkeypatch.setattr(kraken, "get_balances", _balances)
    monkeypatch.setattr(kraken, "get_open_positions", _open_positions)
    monkeypatch.setattr(kraken, "get_trade_balance", _trade_balance)

    r = client.get("/portfolio")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    symbols = {p["symbol"]: p for p in body["positions"]}
    assert symbols["AAPL"]["side"] is None
    assert symbols["BTC/USD"]["side"] == "long"
    assert symbols["BTC/USD"]["marginUsed"] == 4000
    assert body["marginSummary"]["freeMargin"] == 8000
    assert body["marginSummary"]["marginLevel"] == 500


def test_quote_endpoint_returns_period_ladder(monkeypatch):
    ibkr = get_registry().get("ibkr")

    async def _get_quote(symbol: str):
        from app.models import Quote
        return Quote(
            symbol=symbol,
            last=150.0,
            bid=149.9,
            ask=150.1,
            change=1.5,
            change_pct=1.01,
            ts=1_700_000_000_000,
            stale=False,
            source="ibkr",
            day_open=148.5,
            day_high=151.0,
            day_low=147.0,
            volume=1_000_000.0,
        )

    async def _get_candles(symbol: str, interval=None, span=None):
        import time
        from app.models import Candle
        # Build 5 years of daily candles so all period lookbacks have data.
        _DAY_MS = 86_400_000
        now_ms = int(time.time() * 1000)
        count = 5 * 365
        return [
            Candle(t=now_ms - (count - 1 - i) * _DAY_MS, o=100.0, h=105.0, l=95.0, c=100.0 + i * 0.01, v=1_000_000.0)
            for i in range(count)
        ]

    monkeypatch.setattr(ibkr, "get_quote", _get_quote)
    monkeypatch.setattr(ibkr, "get_candles", _get_candles)

    resp = client.get("/quote", params={"symbol": "AAPL"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["quote"]["dayHigh"] is not None
    periods = [p["period"] for p in body["periodChanges"]]
    assert periods == ["1D", "1W", "1M", "3M", "YTD", "1Y", "5Y"]
    assert body["periodStatus"] == "ok"


def test_quote_skips_ladder_when_periods_disabled(monkeypatch):
    ibkr = get_registry().get("ibkr")

    async def _get_quote(symbol: str):
        from app.models import Quote
        return Quote(symbol=symbol, last=150.0, source="ibkr")

    async def _boom(symbol: str, interval=None, span=None):
        raise AssertionError("get_candles must NOT be called when with_periods=false")

    monkeypatch.setattr(ibkr, "get_quote", _get_quote)
    monkeypatch.setattr(ibkr, "get_candles", _boom)

    resp = client.get("/quote", params={"symbol": "AAPL", "with_periods": "false"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["quote"]["last"] == 150.0
    assert body["periodChanges"] == []
    assert body["periodStatus"] == "ok"


def test_quote_survives_period_history_failure(monkeypatch):
    """A candles/history failure surfaces via periodStatus but must NOT drop the
    live quote (CLAUDE.md rule 6)."""
    ibkr = get_registry().get("ibkr")

    async def _get_quote(symbol: str):
        from app.models import Quote
        return Quote(symbol=symbol, last=150.0, day_high=151.0, source="ibkr")

    async def _get_candles(symbol: str, interval=None, span=None):
        from app.adapters.base import SourceUnavailable
        raise SourceUnavailable("history unavailable")

    monkeypatch.setattr(ibkr, "get_quote", _get_quote)
    monkeypatch.setattr(ibkr, "get_candles", _get_candles)

    resp = client.get("/quote", params={"symbol": "AAPL"})
    assert resp.status_code == 200
    body = resp.json()
    # Live quote still returned despite the history failure.
    assert body["status"] == "ok"
    assert body["quote"]["last"] == 150.0
    # Failure surfaced as an explicit, non-ok period status; ladder empty.
    assert body["periodStatus"] != "ok"
    assert body["periodChanges"] == []
