from datetime import datetime, timezone

from app.models import Candle, PeriodChange, Quote, QuoteResponse, SourceStatus


def test_quote_has_optional_day_stats_defaulting_none():
    q = Quote(symbol="AAPL", source="ibkr")
    assert q.day_open is None
    assert q.day_high is None
    assert q.day_low is None
    assert q.volume is None
    assert q.vwap is None
    assert q.week52_high is None
    assert q.week52_low is None
    assert q.market_cap is None


def test_quote_serializes_new_fields_as_camel_case():
    q = Quote(symbol="AAPL", source="ibkr", day_open=1.0, week52_high=2.0, market_cap=3.0)
    dumped = q.model_dump(by_alias=True)
    assert dumped["dayOpen"] == 1.0
    assert dumped["week52High"] == 2.0
    assert dumped["marketCap"] == 3.0


def test_period_change_model():
    pc = PeriodChange(period="1M", change=1.5, change_pct=2.0, ref_close=75.0)
    assert pc.model_dump(by_alias=True) == {
        "period": "1M",
        "change": 1.5,
        "changePct": 2.0,
        "refClose": 75.0,
    }


def test_quote_response_period_defaults():
    resp = QuoteResponse(status=SourceStatus.OK)
    assert resp.period_changes == []
    assert resp.period_status == SourceStatus.OK


# ---------------------------------------------------------------------------
# Task 2: compute_period_changes
# ---------------------------------------------------------------------------
from app.quotes import PERIOD_ORDER, compute_period_changes  # noqa: E402

_DAY_MS = 86_400_000


def _daily_candles(closes: list[float], end_ms: int) -> list[Candle]:
    """closes[-1] is the latest (at end_ms); one bar per day, ascending."""
    n = len(closes)
    out = []
    for i, c in enumerate(closes):
        t = end_ms - (n - 1 - i) * _DAY_MS
        out.append(Candle(t=t, o=c, h=c, l=c, c=c, v=1000.0))
    return out


def test_empty_candles_returns_empty_list():
    assert compute_period_changes([], 1_700_000_000_000) == []


def test_ladder_has_all_periods_in_order():
    now = int(datetime(2026, 6, 2, tzinfo=timezone.utc).timestamp() * 1000)
    candles = _daily_candles([100.0] * 800, now)
    ladder = compute_period_changes(candles, now)
    assert [p.period for p in ladder] == PERIOD_ORDER


def test_one_day_change_uses_prior_close():
    now = int(datetime(2026, 6, 2, tzinfo=timezone.utc).timestamp() * 1000)
    candles = _daily_candles([100.0, 110.0], now)  # yesterday 100, today 110
    ladder = {p.period: p for p in compute_period_changes(candles, now)}
    d1 = ladder["1D"]
    assert d1.ref_close == 100.0
    assert d1.change == 10.0
    assert abs(d1.change_pct - 10.0) < 1e-6


def test_one_month_change_against_close_30_days_ago():
    now = int(datetime(2026, 6, 2, tzinfo=timezone.utc).timestamp() * 1000)
    closes = [float(i) for i in range(1, 61)]  # 60 days, ascending 1..60
    candles = _daily_candles(closes, now)
    ladder = {p.period: p for p in compute_period_changes(candles, now)}
    # 30 days ago = index 60-1-30 = 29 -> close 30.0; latest = 60.0
    assert ladder["1M"].ref_close == 30.0
    assert ladder["1M"].change == 30.0


def test_short_history_yields_none_for_long_periods():
    now = int(datetime(2026, 6, 2, tzinfo=timezone.utc).timestamp() * 1000)
    candles = _daily_candles([100.0, 101.0, 102.0], now)  # only 3 days
    ladder = {p.period: p for p in compute_period_changes(candles, now)}
    assert ladder["5Y"].change_pct is None
    assert ladder["1Y"].change_pct is None
    assert ladder["1D"].change_pct is not None


def test_ytd_uses_last_close_of_previous_year():
    now = int(datetime(2026, 6, 2, tzinfo=timezone.utc).timestamp() * 1000)
    # One bar on Dec 31 2025 (close 200) then a bar today (close 220).
    dec31 = int(datetime(2025, 12, 31, tzinfo=timezone.utc).timestamp() * 1000)
    candles = [
        Candle(t=dec31, o=200.0, h=200.0, l=200.0, c=200.0, v=1.0),
        Candle(t=now, o=220.0, h=220.0, l=220.0, c=220.0, v=1.0),
    ]
    ladder = {p.period: p for p in compute_period_changes(candles, now)}
    assert ladder["YTD"].ref_close == 200.0
    assert ladder["YTD"].change == 20.0
