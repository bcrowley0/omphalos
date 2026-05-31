"""Unit tests for Kraken normalization (pure functions, no network)."""

import pytest

from app.adapters.kraken import (
    krakenize_pair,
    normalize_pair,
    parse_ohlc,
    parse_open_positions,
    parse_ticker,
    parse_trade_balance,
)
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


def test_normalize_pair_legacy_codes():
    assert normalize_pair("XXBTZUSD") == "BTC/USD"
    assert normalize_pair("XETHZUSD") == "ETH/USD"


def test_normalize_pair_modern_codes():
    assert normalize_pair("USDTUSD") == "USDT/USD"


def test_normalize_pair_unmappable_falls_back_to_raw():
    assert normalize_pair("WEIRDXYZ") == "WEIRDXYZ"


def test_parse_open_positions_maps_fields_and_side():
    payload = {
        "error": [],
        "result": {
            "TX1": {
                "pair": "XXBTZUSD", "type": "buy", "vol": "0.5",
                "cost": "20000.0", "margin": "4000.0", "value": "21000.0", "net": "1000.0",
            },
            "TX2": {
                "pair": "XETHZUSD", "type": "sell", "vol": "2.0",
                "cost": "6000.0", "margin": "1200.0", "value": "5800.0", "net": "200.0",
            },
        },
    }
    by_symbol = {p.symbol: p for p in parse_open_positions(payload)}
    assert set(by_symbol) == {"BTC/USD", "ETH/USD"}
    btc = by_symbol["BTC/USD"]
    assert btc.side == "long"
    assert btc.qty == 0.5
    assert btc.avg_cost == 40000.0  # cost / vol
    assert btc.market_value == 21000.0
    assert btc.unrealized_pnl == 1000.0
    assert btc.margin_used == 4000.0
    assert btc.source == "kraken"
    assert by_symbol["ETH/USD"].side == "short"


def test_parse_open_positions_empty_result_is_empty_list():
    assert parse_open_positions({"error": [], "result": {}}) == []


def test_parse_open_positions_consolidates_lots_of_same_pair_and_side():
    payload = {
        "error": [],
        "result": {
            "TX1": {"pair": "XXBTZUSD", "type": "buy", "vol": "1.0",
                    "cost": "30000.0", "margin": "6000.0", "value": "31000.0", "net": "1000.0"},
            "TX2": {"pair": "XXBTZUSD", "type": "buy", "vol": "0.5",
                    "cost": "20000.0", "margin": "4000.0", "value": "15500.0", "net": "-500.0"},
        },
    }
    positions = parse_open_positions(payload)
    assert len(positions) == 1
    btc = positions[0]
    assert btc.symbol == "BTC/USD"
    assert btc.side == "long"
    assert btc.qty == 1.5  # 1.0 + 0.5
    assert btc.avg_cost == pytest.approx(50000.0 / 1.5)  # Σcost / Σqty (size-weighted)
    assert btc.market_value == 46500.0  # 31000 + 15500
    assert btc.unrealized_pnl == 500.0  # 1000 + (-500)
    assert btc.margin_used == 10000.0  # 6000 + 4000


def test_parse_open_positions_keeps_long_and_short_of_same_pair_separate():
    payload = {
        "error": [],
        "result": {
            "TX1": {"pair": "XXBTZUSD", "type": "buy", "vol": "1.0",
                    "cost": "30000.0", "margin": "6000.0", "value": "31000.0", "net": "1000.0"},
            "TX2": {"pair": "XXBTZUSD", "type": "sell", "vol": "0.5",
                    "cost": "15000.0", "margin": "3000.0", "value": "14500.0", "net": "500.0"},
        },
    }
    by_side = {p.side: p for p in parse_open_positions(payload)}
    assert set(by_side) == {"long", "short"}
    assert by_side["long"].qty == 1.0
    assert by_side["short"].qty == 0.5
    assert all(p.symbol == "BTC/USD" for p in by_side.values())


def test_parse_open_positions_zero_total_vol_avg_cost_is_zero():
    payload = {
        "error": [],
        "result": {
            "TX1": {"pair": "XXBTZUSD", "type": "buy", "vol": "0", "cost": "0.0",
                    "margin": "0.0", "value": "0.0", "net": "0.0"},
        },
    }
    positions = parse_open_positions(payload)
    assert len(positions) == 1
    assert positions[0].avg_cost == 0.0


def test_parse_open_positions_zero_vol_avg_cost_is_zero():
    payload = {
        "error": [],
        "result": {
            "TX1": {"pair": "XXBTZUSD", "type": "buy", "vol": "0", "cost": "0.0",
                    "margin": "0.0", "value": "0.0", "net": "0.0"},
        },
    }
    positions = parse_open_positions(payload)
    assert len(positions) == 1
    assert positions[0].avg_cost == 0.0


def test_parse_trade_balance_maps_field_codes():
    payload = {
        "error": [],
        "result": {
            "e": "10000.0", "m": "2000.0", "mf": "8000.0", "ml": "500.0",
            "n": "150.0", "c": "1900.0", "v": "2050.0",
        },
    }
    ms = parse_trade_balance(payload)
    assert ms.equity == 10000.0
    assert ms.used_margin == 2000.0
    assert ms.free_margin == 8000.0
    assert ms.margin_level == 500.0
    assert ms.unrealized_pnl == 150.0
    assert ms.cost_basis == 1900.0
    assert ms.valuation == 2050.0
    assert ms.source == "kraken"


def test_parse_trade_balance_missing_ml_is_none():
    payload = {"error": [], "result": {"e": "100.0", "m": "0.0", "mf": "100.0", "n": "0.0", "c": "0.0", "v": "0.0"}}
    assert parse_trade_balance(payload).margin_level is None


def test_parse_errors_are_mapped():
    with pytest.raises(SourceUnavailable):
        parse_ticker({"error": ["EQuery:Unknown asset pair"], "result": {}}, "NO/PE")
    with pytest.raises(RateLimited):
        parse_ohlc({"error": ["EAPI:Rate limit exceeded"], "result": {}})
