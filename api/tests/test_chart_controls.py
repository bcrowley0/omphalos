"""Tests for chart span/interval controls: enums, maps, adapter mappings."""

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
