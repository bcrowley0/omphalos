"""Pure, unit-tested computation of the multi-period price-change ladder.

Input is the canonical daily `Candle` list (ascending by time) plus a now_ms
reference. Output is the canonical `PeriodChange` ladder. No I/O — the endpoint
fetches the candles and passes them in, so this stays trivially testable.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .models import Candle, PeriodChange

_DAY_MS = 86_400_000

# Display order of the ladder (CLAUDE.md / spec).
PERIOD_ORDER: list[str] = ["1D", "1W", "1M", "3M", "YTD", "1Y", "5Y"]

# Fixed-lookback periods (calendar approximations, ms). YTD is computed separately.
_PERIOD_MS: dict[str, int] = {
    "1D": 1 * _DAY_MS,
    "1W": 7 * _DAY_MS,
    "1M": 30 * _DAY_MS,
    "3M": 90 * _DAY_MS,
    "1Y": 365 * _DAY_MS,
    "5Y": 5 * 365 * _DAY_MS,
}


def _close_at_or_before(candles: list[Candle], cutoff_ms: int) -> float | None:
    """Close of the most recent candle with t <= cutoff_ms, else None.
    Assumes candles ascending by t."""
    ref: float | None = None
    for candle in candles:
        if candle.t <= cutoff_ms:
            ref = candle.c
        else:
            break
    return ref


def _ytd_boundary_ms(now_ms: int) -> int:
    """Epoch-ms of Jan 1 (UTC) of the current year — used as a strict upper bound
    to find the last close of the previous year."""
    dt = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
    jan1 = datetime(dt.year, 1, 1, tzinfo=timezone.utc)
    return int(jan1.timestamp() * 1000)


def compute_period_changes(candles: list[Candle], now_ms: int) -> list[PeriodChange]:
    """Build the period ladder. Empty input -> empty list. A period with no
    qualifying reference close (history too short) yields None values but is
    still listed, preserving PERIOD_ORDER."""
    if not candles:
        return []
    ordered = sorted(candles, key=lambda c: c.t)
    last_close = ordered[-1].c
    out: list[PeriodChange] = []
    for period in PERIOD_ORDER:
        if period == "YTD":
            ref = _close_at_or_before(ordered, _ytd_boundary_ms(now_ms) - 1)
        else:
            ref = _close_at_or_before(ordered, now_ms - _PERIOD_MS[period])
        if ref is None or ref == 0:
            out.append(PeriodChange(period=period))
            continue
        change = round(last_close - ref, 8)
        change_pct = round((change / ref) * 100, 4)
        out.append(PeriodChange(period=period, change=change, change_pct=change_pct, ref_close=ref))
    return out
