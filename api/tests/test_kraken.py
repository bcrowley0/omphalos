"""Unit tests for Kraken normalization (pure functions, no network)."""

from app.adapters.kraken import krakenize_pair, parse_ohlc, parse_ticker
from app.adapters.base import RateLimited, SourceUnavailable
import pytest


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
