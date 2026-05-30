"""FRED adapter — Treasury yield curve (see .claude/rules/fred-and-news.md).

Yield curve = latest observation of each daily Treasury constant-maturity series,
plotted rate vs tenor. Simple api_key query param from api/.env. FRED date strings
are normalized to epoch-ms; emits canonical YieldPoint.

Missing api_key -> Unauthenticated (surfaced as a UI state, never a crash).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from ..cache import cache
from ..config import get_settings
from ..http import get_json
from ..models import YieldPoint
from .base import Adapter, SourceUnavailable, Unauthenticated

_BASE = "https://api.stlouisfed.org/fred/series/observations"
_CURVE_TTL = 60.0

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


def latest_valid_observation(payload: dict[str, Any]) -> tuple[float, int] | None:
    """Pure: pick the most recent non-missing observation -> (rate, obs_ms).

    FRED uses "." for missing values; observations are requested newest-first.
    """
    for obs in payload.get("observations", []):
        value = obs.get("value")
        if value not in (None, ".", ""):
            try:
                return float(value), fred_date_to_ms(obs["date"])
            except (ValueError, KeyError):
                continue
    return None


class FredAdapter(Adapter):
    name = "fred"

    def _api_key(self) -> str:
        key = get_settings().fred_api_key
        if not key:
            raise Unauthenticated("FRED api_key is not set in api/.env")
        return key

    async def _fetch_series(self, series_id: str, api_key: str) -> dict[str, Any]:
        return await get_json(
            _BASE,
            source="fred",
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 8,  # a few recent rows so we can skip "." holidays
            },
        )

    async def get_yield_curve(self) -> list[YieldPoint]:
        api_key = self._api_key()  # raises Unauthenticated if missing

        async def fetch_all() -> list[YieldPoint]:
            # Fetch series SEQUENTIALLY: FRED throttles concurrent bursts (an
            # 11-way parallel fan-out returns mostly HTTP 429). Sequential awaits
            # naturally space the requests under the rate limit; the whole curve
            # is cached for _CURVE_TTL so this runs at most once per minute.
            points: list[YieldPoint] = []
            for i, (sid, label, years) in enumerate(_TENORS):
                if i:
                    await asyncio.sleep(0.35)  # stagger under FRED's burst limit
                payload = None
                for attempt in range(2):  # one retry on a transient throttle
                    try:
                        payload = await self._fetch_series(sid, api_key)
                        break
                    except Exception:  # noqa: BLE001 - skip after a retry; keep the rest
                        await asyncio.sleep(0.6)
                if payload is None:
                    continue
                obs = latest_valid_observation(payload)
                if obs is None:
                    continue
                rate, obs_ms = obs
                points.append(
                    YieldPoint(tenor_label=label, tenor_years=round(years, 4), rate_pct=rate, obs_date=obs_ms)
                )
            if not points:
                raise SourceUnavailable("fred: no observations returned")
            return points

        return await cache.get_or_set("fred:curve", _CURVE_TTL, fetch_all)
