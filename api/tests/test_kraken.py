"""Unit tests for Kraken normalization (pure functions, no network)."""

from app.adapters.kraken import krakenize_pair, parse_ohlc, parse_ticker
from app.adapters.base import RateLimited, SourceUnavailable
from app.models import MarginSummary, Position, PortfolioResponse
import pytest


def test_position_margin_fields_default_to_none():
    p = Position(symbol="AAPL", qty=1, avg_cost=1, market_value=1, unrealized_pnl=0, source="ibkr")
    assert p.side is None
    assert p.margin_used is None


def test_margin_summary_serializes_camelcase():
    ms = MarginSummary(
        equity=1000.0, used_margin=200.0, free_margin=800.0, margin_level=500.0,
        unrealized_pnl=10.0, cost_basis=190.0, valuation=200.0,
    )
    dumped = ms.model_dump(by_alias=True)
    assert dumped["usedMargin"] == 200.0
    assert dumped["marginLevel"] == 500.0
    assert dumped["source"] == "kraken"


def test_portfolio_response_has_margin_summary_default_none():
    r = PortfolioResponse(status="ok")
    assert r.margin_summary is None


def test_krakenize_maps_btc_to_xbt():
    assert krakenize_pair("BTC/USD") == "XBTUSD"
    assert krakenize_pair("eth/usd") == "ETHUSD"
    assert krakenize_pair("DOGE/USD") == "XDGUSD"


def test_parse_ticker_normalizes_quote():
    payload = {
        "error": [],
        "result": {
            "XXBTZUSD": {
                "a": ["73436.40", "1", "1.0"],
                "b": ["73430.10", "2", "2.0"],
                "c": ["73436.40", "0.0001"],
                "o": "73370.70",
            }
        },
    }
    q = parse_ticker(payload, "BTC/USD")
    assert q.symbol == "BTC/USD"
    assert q.last == pytest.approx(73436.40)
    assert q.bid == pytest.approx(73430.10)
    assert q.ask == pytest.approx(73436.40)
    assert q.change == pytest.approx(65.70, abs=1e-6)
    assert q.source == "kraken"


def test_parse_ohlc_converts_seconds_to_ms():
    payload = {
        "error": [],
        "result": {
            "XXBTZUSD": [
                [1717891200, "69291.5", "69809.8", "69155.3", "69649.9", "69520.8", "421.24", 12724],
            ],
            "last": 1717891200,
        },
    }
    candles = parse_ohlc(payload)
    assert len(candles) == 1
    c = candles[0]
    assert c.t == 1717891200 * 1000  # seconds -> ms
    assert (c.o, c.h, c.l, c.c, c.v) == (69291.5, 69809.8, 69155.3, 69649.9, 421.24)


def test_parse_errors_are_mapped():
    with pytest.raises(SourceUnavailable):
        parse_ticker({"error": ["EQuery:Unknown asset pair"], "result": {}}, "NO/PE")
    with pytest.raises(RateLimited):
        parse_ohlc({"error": ["EAPI:Rate limit exceeded"], "result": {}})
