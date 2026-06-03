"""Tests for chart span/interval controls: enums, maps, adapter mappings."""

import httpx
import pytest

from app.adapters.ibkr import IbkrAdapter, ibkr_bar, ibkr_period, parse_history
from app.adapters.ibkr_transport import GatewayTransport
from app.adapters.kraken import kraken_ohlc_params
from app.adapters.mock import MockAdapter
from app.models import (
    INTERVAL_MS,
    SPAN_MS,
    CandlesResponse,
    Interval,
    Span,
    SourceStatus,
)


def test_interval_and_span_enum_values():
    assert Interval.M5.value == "5m"
    assert Interval.W1.value == "1w"
    assert Span.D1.value == "1D"
    assert Span.Y5.value == "5Y"


def test_interval_ms_and_span_ms_cover_every_member():
    assert set(INTERVAL_MS) == set(Interval)
    assert set(SPAN_MS) == set(Span)
    assert INTERVAL_MS[Interval.H1] == 3_600_000
    assert SPAN_MS[Span.D1] == 86_400_000


def test_candles_response_echoes_interval_and_span_in_camelcase():
    resp = CandlesResponse(
        status=SourceStatus.OK,
        symbol="AAPL",
        source="ibkr",
        candles=[],
        interval=Interval.H4,
        span=Span.Y1,
    )
    dumped = resp.model_dump(by_alias=True)
    assert dumped["interval"] == "4h"
    assert dumped["span"] == "1Y"


@pytest.mark.asyncio
async def test_mock_candle_count_and_step_follow_span_and_interval():
    a = MockAdapter()
    candles = await a.get_candles("AAPL", interval=Interval.M5, span=Span.D1)
    # 1 day / 5 minutes = 288 bars
    assert len(candles) == 288
    # Bars are spaced one interval apart.
    assert candles[1].t - candles[0].t == INTERVAL_MS[Interval.M5]


@pytest.mark.asyncio
async def test_mock_candle_count_is_capped_at_720():
    a = MockAdapter()
    candles = await a.get_candles("AAPL", interval=Interval.M1, span=Span.Y5)
    assert len(candles) == 720


@pytest.mark.asyncio
async def test_mock_quote_still_works_after_signature_change():
    a = MockAdapter()
    q = await a.get_quote("AAPL")
    assert q.symbol == "AAPL"
    assert q.last is not None
    assert q.bid < q.last < q.ask


def test_kraken_ohlc_params_minutes_and_bar_aligned_since():
    now_ms = 1_700_000_000_000
    minutes, since = kraken_ohlc_params(Interval.H1, Span.M1, now_ms)
    assert minutes == 60
    raw = (now_ms - SPAN_MS[Span.M1]) // 1000
    bar_s = 60 * 60
    assert since == raw - (raw % bar_s)  # aligned to the bar boundary
    assert since == 1_697_407_200  # fixed oracle: 2023-10-15T22:00:00Z, floored to the hour


def test_kraken_ohlc_params_one_minute_bar():
    now_ms = 1_700_000_000_000
    minutes, since = kraken_ohlc_params(Interval.M1, Span.D1, now_ms)
    assert minutes == 1
    raw = (now_ms - SPAN_MS[Span.D1]) // 1000
    assert since == raw - (raw % 60)


def test_ibkr_bar_and_period_tokens():
    assert ibkr_bar(Interval.M5) == "5min"
    assert ibkr_bar(Interval.M15) == "15min"
    assert ibkr_bar(Interval.H4) == "4h"
    assert ibkr_bar(Interval.W1) == "1w"
    assert ibkr_period(Span.D5) == "5d"
    assert ibkr_period(Span.M1) == "1m"
    assert ibkr_period(Span.Y5) == "5y"


def test_parse_history_keeps_ms_timestamps():
    payload = {"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 99}]}
    candles = parse_history(payload)
    assert len(candles) == 1
    c = candles[0]
    assert c.t == 1_700_000_000_000  # already ms — NOT multiplied
    assert (c.o, c.h, c.l, c.c, c.v) == (1.0, 2.0, 0.5, 1.5, 99.0)


def test_parse_history_empty_payload():
    assert parse_history({}) == []
    assert parse_history({"data": []}) == []


@pytest.mark.asyncio
async def test_ibkr_get_candles_drives_history_endpoint():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/tickle"):
            return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}})
        if path.endswith("/iserver/accounts"):
            return httpx.Response(200, json=[{"id": "DU1"}])
        if path.endswith("/iserver/secdef/search"):
            return httpx.Response(
                200,
                json=[{"conid": 265598, "description": "NASDAQ", "sections": [{"secType": "STK"}]}],
            )
        if path.endswith("/iserver/marketdata/history"):
            captured["query"] = dict(req.url.params)
            return httpx.Response(
                200, json={"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 9}]}
            )
        return httpx.Response(404, json={})

    a = IbkrAdapter()
    t = GatewayTransport("https://gw.local/v1/api")
    t._client = httpx.AsyncClient(
        base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler)
    )
    a._transport = t
    candles = await a.get_candles("AAPL", interval=Interval.H4, span=Span.Y1)
    assert len(candles) == 1 and candles[0].c == 1.5
    assert captured["query"]["conid"] == "265598"
    assert captured["query"]["bar"] == "4h"
    assert captured["query"]["period"] == "1y"


@pytest.mark.asyncio
async def test_ibkr_get_candles_retries_when_first_history_empty():
    state = {"history_calls": 0}

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
            state["history_calls"] += 1
            if state["history_calls"] == 1:
                return httpx.Response(200, json={"data": []})  # first call empty -> retry
            return httpx.Response(
                200, json={"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 9}]}
            )
        return httpx.Response(404, json={})

    a = IbkrAdapter()
    t = GatewayTransport("https://gw.local/v1/api")
    t._client = httpx.AsyncClient(
        base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler)
    )
    a._transport = t
    candles = await a.get_candles("AAPL")
    assert state["history_calls"] == 2
    assert len(candles) == 1
