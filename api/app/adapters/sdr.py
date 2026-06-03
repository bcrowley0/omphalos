"""SDR adapter — public CFTC swap data via DTCC's price dissemination platform.

DTCC (a CFTC-registered Swap Data Repository) publishes free, no-auth end-of-day
cumulative files. We fetch the RATES file, unzip it in memory, and normalize the
raw print tape into canonical SwapCurve/SwapTenorPoint shapes: for SOFR and US
CPI swaps, the median fixed rate plus trade count and summed notional per standard
tenor. It is a transaction tape, not a benchmark curve — see the design spec.

The CSV parse is split into small pure functions (unit-tested without network);
the fetch/unzip/date-walk lives in the SdrAdapter shell.
"""

from __future__ import annotations

import csv
import io
import statistics
import zipfile
from datetime import date, datetime, timedelta, timezone

from ..cache import cache
from ..http import get_bytes
from ..models import SwapCurve, SwapTenorPoint
from .base import Adapter, SourceUnavailable, Unauthenticated

_BASE = "https://kgc0418-tdw-data-0.s3.amazonaws.com/cftc/eod"
_TTL = 3600.0          # one new file per UTC day; cache the parsed result an hour
_WALKBACK_DAYS = 5     # walk back to skip weekends/holidays with no published file

# Standard quoting tenors (label, years). Prints bucket to the nearest of these.
_STD_TENORS: list[tuple[str, float]] = [
    ("1Y", 1.0), ("2Y", 2.0), ("3Y", 3.0), ("5Y", 5.0), ("7Y", 7.0),
    ("10Y", 10.0), ("15Y", 15.0), ("20Y", 20.0), ("30Y", 30.0),
]

# (curve key, human label) — the two products this widget surfaces.
_PRODUCTS: list[tuple[str, str]] = [
    ("sofr", "SOFR OIS"),
    ("cpi", "US CPI (zero-coupon)"),
]


def classify_underlier(name: str) -> str | None:
    """Map a `UPI Underlier Name` to "sofr", "cpi", or None. Pure.

    SOFR = contains USD-SOFR and is NOT a basis/cross-currency leg (no " vs ").
    CPI  = exactly USA-CPI-U (US CPI Urban Consumers); other inflation excluded.
    """
    n = name.strip().upper()
    if not n:
        return None
    if n == "USA-CPI-U":
        return "cpi"
    if "USD-SOFR" in n and " VS " not in n:
        return "sofr"
    return None


def parse_notional(raw: str) -> tuple[float, bool]:
    """'250,000,000+' -> (250000000.0, True). A trailing '+' marks a capped
    (anonymized) notional. Non-numeric -> (0.0, False). Pure."""
    s = raw.strip()
    capped = s.endswith("+")
    if capped:
        s = s[:-1]
    s = s.replace(",", "").strip()
    try:
        return float(s), capped
    except ValueError:
        return 0.0, False


def pick_fixed_rate(row: dict[str, str]) -> float | None:
    """First populated fixed-rate leg, as a percent (decimal x100). Pure."""
    for col in ("Fixed rate-Leg 1", "Fixed rate-Leg 2"):
        raw = (row.get(col) or "").strip()
        if raw:
            try:
                return float(raw) * 100.0
            except ValueError:
                continue
    return None


def tenor_years(effective: str, expiration: str) -> float | None:
    """(expiration - effective) in 365.25-day years. None on bad/empty/reversed
    dates. Pure."""
    try:
        eff = date.fromisoformat((effective or "").strip())
        exp = date.fromisoformat((expiration or "").strip())
    except ValueError:
        return None
    days = (exp - eff).days
    if days <= 0:
        return None
    return days / 365.25


def bucket_tenor(years: float) -> tuple[str, float] | None:
    """Nearest standard tenor, accepted only if within max(0.5y, 15% of the
    tenor). Returns (label, years) or None (off-tenor print, dropped). Pure."""
    best_label, best_std, best_diff = "", 0.0, float("inf")
    for label, std in _STD_TENORS:
        diff = abs(years - std)
        if diff < best_diff:
            best_label, best_std, best_diff = label, std, diff
    if best_diff > max(0.5, best_std * 0.15):
        return None
    return (best_label, best_std)


def _leg_notional(row: dict[str, str]) -> float:
    """First populated notional leg (value only; cap flag dropped at aggregate)."""
    for col in ("Notional amount-Leg 1", "Notional amount-Leg 2"):
        raw = (row.get(col) or "").strip()
        if raw:
            value, _capped = parse_notional(raw)
            return value
    return 0.0


def aggregate(samples: list[tuple[str, float, float, float]]) -> list[SwapTenorPoint]:
    """samples = [(tenor_label, tenor_years, rate_pct, notional)] -> one
    SwapTenorPoint per tenor (median rate, count, summed notional), sorted by
    tenor_years ascending. Pure."""
    by_label: dict[str, dict] = {}
    for label, years, rate, notional in samples:
        bucket = by_label.setdefault(label, {"years": years, "rates": [], "notional": 0.0})
        bucket["rates"].append(rate)
        bucket["notional"] += notional
    points = [
        SwapTenorPoint(
            tenor_label=label,
            tenor_years=bucket["years"],
            rate_pct=round(statistics.median(bucket["rates"]), 6),
            trade_count=len(bucket["rates"]),
            total_notional=bucket["notional"],
        )
        for label, bucket in by_label.items()
    ]
    points.sort(key=lambda p: p.tenor_years)
    return points


def parse_rates_csv(text: str, obs_date_ms: int) -> list[SwapCurve]:
    """Full pure transform: a RATES CSV -> [SwapCurve(sofr), SwapCurve(cpi)].

    Keeps only new trades (Action type NEWT) in the IR asset class with a valid
    fixed rate and tenor; classifies by underlier; buckets to standard tenors;
    aggregates to a median rate per tenor."""
    samples: dict[str, list[tuple[str, float, float, float]]] = {"sofr": [], "cpi": []}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        if (row.get("Action type") or "").strip().upper() != "NEWT":
            continue
        if (row.get("Asset Class") or "").strip().upper() != "IR":
            continue
        product = classify_underlier(row.get("UPI Underlier Name") or "")
        if product is None:
            continue
        rate = pick_fixed_rate(row)
        if rate is None:
            continue
        years = tenor_years(row.get("Effective Date") or "", row.get("Expiration Date") or "")
        if years is None:
            continue
        bucket = bucket_tenor(years)
        if bucket is None:
            continue
        label, std = bucket
        samples[product].append((label, std, rate, _leg_notional(row)))
    return [
        SwapCurve(key=key, label=label, obs_date=obs_date_ms, points=aggregate(samples[key]))
        for key, label in _PRODUCTS
    ]


class SdrAdapter(Adapter):
    name = "sdr"

    def _url(self, d: date) -> str:
        return f"{_BASE}/CFTC_CUMULATIVE_RATES_{d.strftime('%Y_%m_%d')}.zip"

    async def _fetch_csv(self, d: date) -> str:
        """Fetch the day's ZIP and return its single CSV member as text.

        A not-yet-published date surfaces as a "file unavailable" exception: this
        public S3 bucket denies ListBucket, so a missing key returns HTTP 403
        (mapped to Unauthenticated), not 404 — the walk-back treats both as
        "try the previous day"."""
        content = await get_bytes(self._url(d), source="sdr")
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            member = zf.namelist()[0]
            with zf.open(member) as fh:
                return fh.read().decode("utf-8", errors="replace")

    async def get_swap_rates(self) -> list[SwapCurve]:
        """Latest available EOD file: walk back from today (UTC) until a file is
        found, parse SOFR + US CPI rate-by-tenor, cache the result per file date."""
        today = datetime.now(timezone.utc).date()
        for back in range(_WALKBACK_DAYS + 1):
            d = today - timedelta(days=back)
            obs_ms = int(
                datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000
            )

            async def build(_d: date = d, _obs: int = obs_ms) -> list[SwapCurve]:
                text = await self._fetch_csv(_d)
                return parse_rates_csv(text, _obs)

            try:
                return await cache.get_or_set(f"sdr:swaps:{d.isoformat()}", _TTL, build)
            except (SourceUnavailable, Unauthenticated):
                # Either status means "no file for this date" (see _fetch_csv);
                # fall back to the previous day rather than surfacing it.
                continue
        # Public source: exhausting the window is a "source down", never an auth
        # problem — surface it as such (not the last 403 we saw).
        raise SourceUnavailable("sdr: no recent RATES file found in the lookback window")
