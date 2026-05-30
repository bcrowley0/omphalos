"""FRED adapter — Treasury yield curve (see .claude/rules/fred-and-news.md).

Yield curve = latest observation of each daily Treasury constant-maturity series,
plotted rate vs tenor. Simple api_key query param from api/.env. FRED date strings
are normalized to epoch-ms; emits canonical YieldPoint.

Missing api_key -> Unauthenticated (surfaced as a UI state, never a crash).
"""

from __future__ import annotations

import asyncio
import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ..cache import cache
from ..config import get_settings
from ..http import get_json
from ..models import AsOfCurve, YieldPoint
from .base import Adapter, SourceUnavailable, Unauthenticated

_BASE = "https://api.stlouisfed.org/fred/series/observations"
_HISTORY_TTL = 60.0
_DEFAULT_WINDOW_DAYS = 400  # ~13 months: covers a 1y lookback plus holidays/buffer

_PERIOD_LABELS = {
    "1d": "1D ago",
    "1w": "1W ago",
    "1m": "1M ago",
    "3m": "3M ago",
    "6m": "6M ago",
    "1y": "1Y ago",
}
_PRESET_PERIODS = ("1d", "1w", "1m", "3m", "6m", "1y")

# (FRED series id, display label, tenor in years). Verified candidate set from
# the per-source rules; constant-maturity daily Treasury series.
_TENORS: list[tuple[str, str, float]] = [
    ("DGS1MO", "1M", 1 / 12),
    ("DGS3MO", "3M", 0.25),
    ("DGS6MO", "6M", 0.5),
    ("DGS1", "1Y", 1.0),
    ("DGS2", "2Y", 2.0),
    ("DGS3", "3Y", 3.0),
    ("DGS5", "5Y", 5.0),
    ("DGS7", "7Y", 7.0),
    ("DGS10", "10Y", 10.0),
    ("DGS20", "20Y", 20.0),
    ("DGS30", "30Y", 30.0),
]


def fred_date_to_ms(date_str: str) -> int:
    """`YYYY-MM-DD` -> UTC epoch ms. Pure/testable."""
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def parse_observations(payload: dict[str, Any]) -> list[tuple[int, float]]:
    """All valid observations -> [(obs_ms, rate)] sorted ascending by date.

    Drops FRED "." / empty markers. Pure/testable.
    """
    out: list[tuple[int, float]] = []
    for obs in payload.get("observations", []):
        value = obs.get("value")
        if value in (None, ".", ""):
            continue
        try:
            out.append((fred_date_to_ms(obs["date"]), float(value)))
        except (ValueError, KeyError):
            continue
    out.sort(key=lambda pair: pair[0])
    return out


def latest_on_or_before(series: list[tuple[int, float]], target_ms: int) -> tuple[int, float] | None:
    """Pure: the latest (obs_ms, rate) with obs_ms <= target_ms.

    `series` must be sorted ascending by obs_ms. Returns None if every
    observation is after the target.
    """
    hit: tuple[int, float] | None = None
    for obs_ms, rate in series:
        if obs_ms <= target_ms:
            hit = (obs_ms, rate)
        else:
            break
    return hit


_PERIOD_DAYS = {"1d": 1, "1w": 7}
_PERIOD_MONTHS = {"1m": 1, "3m": 3, "6m": 6, "1y": 12}


def _subtract_months(dt: datetime, months: int) -> datetime:
    index = dt.month - 1 - months
    year = dt.year + index // 12
    month = index % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])  # clamp short months
    return dt.replace(year=year, month=month, day=day)


def relative_target(current_ms: int, period: str) -> int:
    """Pure: calendar subtraction from `current_ms` (epoch ms) for a relative
    lookback. period in 1d/1w/1m/3m/6m/1y."""
    dt = datetime.fromtimestamp(current_ms / 1000, tz=timezone.utc)
    if period in _PERIOD_DAYS:
        dt = dt - timedelta(days=_PERIOD_DAYS[period])
    elif period in _PERIOD_MONTHS:
        dt = _subtract_months(dt, _PERIOD_MONTHS[period])
    else:
        raise ValueError(f"unknown period: {period}")
    return int(dt.timestamp() * 1000)


def resolve_as_of(history: dict[str, list[tuple[int, float]]], target_ms: int) -> list[YieldPoint]:
    """Pure: build a curve as of `target_ms` from a per-series history. Aligns by
    tenor; omits any tenor with no observation on or before the target."""
    points: list[YieldPoint] = []
    for series_id, label, years in _TENORS:
        hit = latest_on_or_before(history.get(series_id, []), target_ms)
        if hit is None:
            continue
        obs_ms, rate = hit
        points.append(
            YieldPoint(tenor_label=label, tenor_years=round(years, 4), rate_pct=rate, obs_date=obs_ms)
        )
    return points


def _curve_obs_date(points: list[YieldPoint], fallback_ms: int) -> int:
    return max((p.obs_date for p in points), default=fallback_ms)


class FredAdapter(Adapter):
    name = "fred"

    def _api_key(self) -> str:
        key = get_settings().fred_api_key
        if not key:
            raise Unauthenticated("FRED api_key is not set in api/.env")
        return key

    async def _fetch_series(self, series_id: str, api_key: str, start_iso: str) -> dict[str, Any]:
        return await get_json(
            _BASE,
            source="fred",
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "sort_order": "asc",
                "observation_start": start_iso,
            },
        )

    async def _history(self, start_ms: int) -> dict[str, list[tuple[int, float]]]:
        """Fetch (and cache) the full daily history for every tenor from
        `start_ms` to now. Cached per window-start so older exact-date requests
        get their own (wider) cache entry."""
        api_key = self._api_key()  # raises Unauthenticated if missing
        start_iso = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

        async def fetch_all() -> dict[str, list[tuple[int, float]]]:
            # Sequential fetch: FRED throttles concurrent bursts (an 11-way
            # parallel fan-out returns mostly HTTP 429). Sequential awaits space
            # the requests; the whole history is cached for _HISTORY_TTL.
            history: dict[str, list[tuple[int, float]]] = {}
            for i, (series_id, _label, _years) in enumerate(_TENORS):
                if i:
                    await asyncio.sleep(0.35)  # stagger under FRED's burst limit
                payload = None
                for _attempt in range(2):  # one retry on a transient throttle
                    try:
                        payload = await self._fetch_series(series_id, api_key, start_iso)
                        break
                    except Exception:  # noqa: BLE001 - skip after a retry; keep the rest
                        await asyncio.sleep(0.6)
                if payload is None:
                    continue
                history[series_id] = parse_observations(payload)
            if not any(history.values()):
                raise SourceUnavailable("fred: no observations returned")
            return history

        return await cache.get_or_set(f"fred:curve:history:{start_iso}", _HISTORY_TTL, fetch_all)

    async def get_yield_curve(self, asof_dates: list[date]) -> list[AsOfCurve]:
        """Build current + relative presets + any exact-date curves from a single
        cached history pass. `asof_dates` are exact calendar dates to add."""
        # Widen the window if an exact date predates the default ~13-month window.
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        default_start = now_ms - _DEFAULT_WINDOW_DAYS * 86_400_000
        start_ms = default_start
        for d in asof_dates:
            d_ms = fred_date_to_ms(d.isoformat()) - 7 * 86_400_000  # buffer for on-or-before
            start_ms = min(start_ms, d_ms)

        history = await self._history(start_ms)

        latest_dates = [series[-1][0] for series in history.values() if series]
        if not latest_dates:
            raise SourceUnavailable("fred: no observations returned")
        current_ms = max(latest_dates)

        curves: list[AsOfCurve] = []
        cur_points = resolve_as_of(history, current_ms)
        curves.append(
            AsOfCurve(
                key="current",
                label="Today",
                requested_date=current_ms,
                obs_date=_curve_obs_date(cur_points, current_ms),
                points=cur_points,
            )
        )
        for period in _PRESET_PERIODS:
            target = relative_target(current_ms, period)
            pts = resolve_as_of(history, target)
            curves.append(
                AsOfCurve(
                    key=period,
                    label=_PERIOD_LABELS[period],
                    requested_date=target,
                    obs_date=_curve_obs_date(pts, target),
                    points=pts,
                )
            )
        for d in asof_dates:
            target = fred_date_to_ms(d.isoformat())
            pts = resolve_as_of(history, target)
            curves.append(
                AsOfCurve(
                    key=d.isoformat(),
                    label=d.strftime("%b %d, %Y"),
                    requested_date=target,
                    obs_date=_curve_obs_date(pts, target),
                    points=pts,
                )
            )
        return curves
