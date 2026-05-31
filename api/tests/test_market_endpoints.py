import app.routers as routers
from app.adapters.base import Adapter
from app.models import Candle, Interval, Quote, Span
from fastapi.testclient import TestClient

from app.main import app


class FakeAdapter(Adapter):
    """Records the symbol it was called with and returns canned data."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.quote_calls: list[str] = []
        self.candle_calls: list[str] = []

    async def get_quote(self, symbol: str) -> Quote:
        self.quote_calls.append(symbol)
        return Quote(symbol=symbol, last=1.0, source=self.name)

    async def get_candles(
        self, symbol: str, interval=Interval.D1, span=Span.M1
    ) -> list[Candle]:
        self.candle_calls.append(symbol)
        return [Candle(t=0, o=1, h=1, l=1, c=1, v=1)]


class FakeRegistry:
    def __init__(self) -> None:
        self.kraken = FakeAdapter("kraken")
        self.ibkr = FakeAdapter("ibkr")

    def get(self, name: str):
        return {"kraken": self.kraken, "ibkr": self.ibkr}.get(name)


def _client(monkeypatch) -> tuple[TestClient, FakeRegistry]:
    reg = FakeRegistry()
    monkeypatch.setattr(routers, "get_registry", lambda: reg)
    return TestClient(app), reg


def test_quote_btc_routes_to_kraken_with_canonical_pair(monkeypatch):
    client, reg = _client(monkeypatch)
    r = client.get("/quote", params={"symbol": "btc"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["quote"]["symbol"] == "BTC/USD"
    assert body["quote"]["source"] == "kraken"
    assert reg.kraken.quote_calls == ["BTC/USD"]
    assert reg.ibkr.quote_calls == []


def test_quote_aapl_routes_to_ibkr(monkeypatch):
    client, reg = _client(monkeypatch)
    r = client.get("/quote", params={"symbol": "aapl"})
    assert r.json()["quote"]["source"] == "ibkr"
    assert reg.ibkr.quote_calls == ["AAPL"]


def test_chart_btcusd_routes_to_kraken_and_echoes_canonical(monkeypatch):
    client, reg = _client(monkeypatch)
    r = client.get("/chart", params={"symbol": "btcusd"})
    body = r.json()
    assert body["symbol"] == "BTC/USD"
    assert body["source"] == "kraken"
    assert len(body["candles"]) == 1
    assert reg.kraken.candle_calls == ["BTC/USD"]


def test_crypto_endpoint_is_gone(monkeypatch):
    client, _ = _client(monkeypatch)
    assert client.get("/crypto/BTC/USD").status_code == 404
