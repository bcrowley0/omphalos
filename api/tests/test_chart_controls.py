"""Tests for chart span/interval controls: enums, maps, adapter mappings."""

import pytest

from app.adapters.mock import MockAdapter
from app.models import (
    INTERVAL_MS,
    SPAN_MS,
    CandlesResponse,
    CryptoResponse,
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


def test_crypto_response_default_pair_is_coherent():
    # The API fallback default pair must be a valid span/interval combo: 1M + 1h.
    resp = CryptoResponse(status=SourceStatus.EMPTY, pair="BTC/USD", source="kraken")
    assert resp.interval == Interval.H1
    assert resp.span == Span.M1


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
