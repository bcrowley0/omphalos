# Swaps Widget (CFTC SDR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `swaps` command/widget that shows SOFR and US CPI swap rate-by-tenor summaries derived from DTCC's public CFTC Swap Data Repository end-of-day file.

**Architecture:** A new backend `sdr` adapter fetches DTCC's free, no-auth daily cumulative RATES ZIP, unzips it in memory, filters/normalizes the raw print tape into canonical `SwapCurve`/`SwapTenorPoint` shapes (median fixed rate, trade count, total notional per standard tenor), exposed at `GET /swaps`. The frontend regenerates its TypeScript from the OpenAPI schema and adds a `SwapsWidget` rendering two stacked tenor tables (SOFR, US CPI). EOD data → manual refresh only, no auto-refresh.

**Tech Stack:** FastAPI + Pydantic (Python 3.14), Python stdlib `zipfile`/`csv`/`statistics`, Next.js + TypeScript + React, openapi-typescript codegen, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-06-02-swaps-sdr-widget-design.md`

---

## Prerequisites (environment)

This is a fresh worktree. Per `README.md`, each worktree uses its own editable venv. Before starting, ensure the backend venv and web deps exist:

```bash
# from the worktree root
cd api && python3 -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt && ./.venv/bin/pip install -e . ; cd ..
cd web && npm install ; cd ..
```

If `api/.venv` already exists, skip the venv creation. Verify the baseline is green before changing anything:

```bash
cd api && ./.venv/bin/pytest -q ; cd ..
cd web && npm test ; cd ..
```

Expected: all existing tests pass. If not, stop and report.

---

## File Structure

**Backend (create):**
- `api/app/adapters/sdr.py` — the SDR adapter: pure normalization helpers + impure fetch/unzip shell.
- `api/tests/test_sdr.py` — unit tests for the pure helpers + the adapter shell (monkeypatched fetch).

**Backend (modify):**
- `api/app/models.py` — add `SwapTenorPoint`, `SwapCurve`, `SwapsResponse`.
- `api/app/adapters/base.py` — add `get_swap_rates()` capability (default raises `NotSupported`).
- `api/app/http.py` — add `get_bytes()` binary fetch helper.
- `api/app/adapters/__init__.py` — export `SdrAdapter` (only if the package re-exports adapters; otherwise skip).
- `api/app/deps.py` — register `SdrAdapter()`.
- `api/app/routers.py` — add `GET /swaps`.
- `api/tests/test_routers.py` — add `/swaps` router tests.

**Frontend (modify):**
- `web/app/lib/api/schema.ts` — regenerated (not hand-edited).
- `web/app/lib/api/client.ts` — re-export `SwapCurve`/`SwapTenorPoint` convenience types.
- `web/app/lib/loaders.ts` — add `loadSwaps()`.
- `web/app/lib/command/types.ts` — add `swaps` to `Command` and `WidgetKind`.
- `web/app/lib/command/parser.ts` — parse `swaps`.
- `web/app/lib/command/tabs.ts` — map `swaps` → tab.
- `web/app/lib/command/parser.test.ts` — test `swaps` parse.
- `web/app/lib/command/tabs.test.ts` — test `swaps` tab.
- `web/app/components/WidgetHost.tsx` — render `SwapsWidget`.
- `web/app/widgets/HelpWidget.tsx` — add `swaps` to the command list.

**Frontend (create):**
- `web/app/widgets/SwapsWidget.tsx` — the widget.

---

## Task 1: Canonical models + base adapter capability

**Files:**
- Modify: `api/app/models.py`
- Modify: `api/app/adapters/base.py`
- Test: `api/tests/test_sdr.py` (new)

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_sdr.py`:

```python
"""Unit tests for the SDR (CFTC swap data repository) adapter — pure functions
plus the fetch/unzip shell (monkeypatched, no network)."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.models import SwapCurve, SwapTenorPoint, SwapsResponse, SourceStatus


def test_models_camel_case_on_the_wire():
    point = SwapTenorPoint(
        tenor_label="10Y", tenor_years=10.0, rate_pct=3.98, trade_count=2, total_notional=75_000_000.0
    )
    dumped = point.model_dump(by_alias=True)
    assert dumped["tenorLabel"] == "10Y"
    assert dumped["totalNotional"] == 75_000_000.0

    curve = SwapCurve(key="sofr", label="SOFR OIS", obs_date=1_700_000_000_000, points=[point])
    resp = SwapsResponse(status=SourceStatus.OK, file_date=1_700_000_000_000, curves=[curve])
    body = resp.model_dump(by_alias=True)
    assert body["fileDate"] == 1_700_000_000_000
    assert body["curves"][0]["key"] == "sofr"
    assert body["curves"][0]["points"][0]["tenorLabel"] == "10Y"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_sdr.py -q`
Expected: FAIL — `ImportError: cannot import name 'SwapCurve' from 'app.models'`.

- [ ] **Step 3: Add the models**

In `api/app/models.py`, after the `AsOfCurve` class (around line 169), add:

```python
class SwapTenorPoint(CamelModel):
    """One standard tenor's summary from a day of SDR swap prints: the median
    fixed rate, how many prints fell in the bucket, and their summed notional."""

    tenor_label: str          # "1Y", "2Y", ... "30Y"
    tenor_years: float        # standard bucket value (e.g. 10.0)
    rate_pct: float           # median fixed rate, percent
    trade_count: int          # prints in this bucket
    total_notional: float     # summed notional (USD); capped prints counted at cap


class SwapCurve(CamelModel):
    """SOFR or US CPI swap rates by tenor, as of one EOD SDR file."""

    key: str                  # "sofr" | "cpi"
    label: str                # human label, e.g. "SOFR OIS"
    obs_date: int             # UTC epoch ms of the file's report date
    points: list[SwapTenorPoint] = []
```

Then, in the "Response envelopes" section (after `YieldCurveResponse`, around line 204), add:

```python
class SwapsResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    file_date: int | None = None   # UTC epoch ms of the EOD file actually used
    curves: list[SwapCurve] = []
```

- [ ] **Step 4: Add the base-adapter capability**

In `api/app/adapters/base.py`, update the model import line (line 15) to include the new types:

```python
from ..models import (
    AsOfCurve,
    Balance,
    Candle,
    Interval,
    NewsItem,
    Position,
    Quote,
    Span,
    SwapCurve,
)
```

Then, after the `get_yield_curve` method (around line 62), add:

```python
    async def get_swap_rates(self) -> list[SwapCurve]:
        raise NotSupported(f"{self.name} does not support swap rates")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_sdr.py -q`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add api/app/models.py api/app/adapters/base.py api/tests/test_sdr.py
git commit -m "feat(api): canonical SwapTenorPoint/SwapCurve models + adapter capability"
```

---

## Task 2: Binary HTTP fetch helper

**Files:**
- Modify: `api/app/http.py`
- Test: `api/tests/test_http.py`

- [ ] **Step 1: Write the failing test**

In `api/tests/test_http.py`, add (keep existing imports; add `get_bytes` to the `from app.http import ...` line if present, else import it in the test):

```python
def test_get_bytes_returns_raw_content():
    import asyncio
    import httpx
    from app.http import get_bytes

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"\x50\x4b\x03\x04rawzip")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    out = asyncio.run(get_bytes("https://example.test/file.zip", source="sdr", client=client))
    assert out == b"\x50\x4b\x03\x04rawzip"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_http.py::test_get_bytes_returns_raw_content -q`
Expected: FAIL — `ImportError: cannot import name 'get_bytes'`.

- [ ] **Step 3: Add the helper**

In `api/app/http.py`, after `get_text` (around line 76), add:

```python
async def get_bytes(
    url: str, *, source: str, client: httpx.AsyncClient | None = None, **kwargs: Any
) -> bytes:
    resp = await _request("GET", url, source=source, client=client, **kwargs)
    return resp.content
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_http.py::test_get_bytes_returns_raw_content -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/http.py api/tests/test_http.py
git commit -m "feat(api): add get_bytes binary fetch helper to http layer"
```

---

## Task 3: SDR adapter — pure normalization functions

**Files:**
- Create: `api/app/adapters/sdr.py`
- Test: `api/tests/test_sdr.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_sdr.py`:

```python
from app.adapters.sdr import (
    classify_underlier,
    parse_notional,
    pick_fixed_rate,
    tenor_years,
    bucket_tenor,
    aggregate,
    parse_rates_csv,
)

# Minimal fixture: only the columns the parser reads (real files have 110).
FIXTURE_CSV = (
    "Action type,Asset Class,Effective Date,Expiration Date,"
    "Fixed rate-Leg 1,Fixed rate-Leg 2,Notional amount-Leg 1,Notional amount-Leg 2,"
    "UPI Underlier Name\n"
    # SOFR 10Y, rate on leg 2
    "NEWT,IR,2025-06-02,2035-06-02,,0.0396408,25000000,,USD-SOFR-OIS Compound\n"
    # SOFR ~10Y, rate on leg 1 (different spelling -> still SOFR)
    "NEWT,IR,2025-06-02,2035-06-01,0.0400000,,50000000,,USD-SOFR-COMPOUND\n"
    # US CPI 1Y
    "NEWT,IR,2025-05-21,2026-05-21,0.03235,,93000000,,USA-CPI-U\n"
    # SOFR 5Y with a CAPPED notional
    "NEWT,IR,2025-06-02,2030-06-02,,0.038,250000000+,,USD-SOFR-OIS Compound\n"
    # basis ' vs ' -> EXCLUDED
    "NEWT,IR,2025-06-02,2035-06-02,,0.01,10000000,,EUR-EURIBOR vs USD-SOFR-OIS Compound\n"
    # non-USD inflation -> EXCLUDED
    "NEWT,IR,2025-05-21,2026-05-21,0.02,,1000000,,EUR-EXT-CPI\n"
    # MODI action -> EXCLUDED
    "MODI,IR,2025-06-02,2035-06-02,,0.05,10000000,,USD-SOFR-OIS Compound\n"
)


def test_classify_underlier():
    assert classify_underlier("USD-SOFR-OIS Compound") == "sofr"
    assert classify_underlier("usd-sofr-compound") == "sofr"
    assert classify_underlier("USA-CPI-U") == "cpi"
    assert classify_underlier("EUR-EURIBOR vs USD-SOFR-OIS Compound") is None  # basis
    assert classify_underlier("EUR-EXT-CPI") is None
    assert classify_underlier("") is None


def test_parse_notional():
    assert parse_notional("25,000,000") == (25_000_000.0, False)
    assert parse_notional("250,000,000+") == (250_000_000.0, True)
    assert parse_notional("") == (0.0, False)
    assert parse_notional("n/a") == (0.0, False)


def test_pick_fixed_rate_prefers_populated_leg_and_converts_to_percent():
    assert pick_fixed_rate({"Fixed rate-Leg 1": "", "Fixed rate-Leg 2": "0.0396408"}) == pytest.approx(3.96408)
    assert pick_fixed_rate({"Fixed rate-Leg 1": "0.04", "Fixed rate-Leg 2": ""}) == pytest.approx(4.0)
    assert pick_fixed_rate({"Fixed rate-Leg 1": "", "Fixed rate-Leg 2": ""}) is None


def test_tenor_years():
    assert tenor_years("2025-06-02", "2035-06-02") == pytest.approx(9.9986, abs=1e-3)
    assert tenor_years("2025-05-21", "2026-05-21") == pytest.approx(0.9993, abs=1e-3)
    assert tenor_years("2035-06-02", "2025-06-02") is None  # reversed
    assert tenor_years("", "2035-06-02") is None


def test_bucket_tenor():
    assert bucket_tenor(9.9986) == ("10Y", 10.0)
    assert bucket_tenor(4.999) == ("5Y", 5.0)
    assert bucket_tenor(0.9993) == ("1Y", 1.0)
    assert bucket_tenor(4.0) is None  # between 3Y and 5Y, outside tolerance


def test_aggregate_medians_per_tenor_sorted_by_years():
    samples = [
        ("10Y", 10.0, 3.96408, 25_000_000.0),
        ("10Y", 10.0, 4.0, 50_000_000.0),
        ("5Y", 5.0, 3.8, 250_000_000.0),
    ]
    points = aggregate(samples)
    assert [p.tenor_label for p in points] == ["5Y", "10Y"]  # sorted by tenor_years
    ten = points[1]
    assert ten.trade_count == 2
    assert ten.rate_pct == pytest.approx(3.98204)
    assert ten.total_notional == 75_000_000.0


def test_parse_rates_csv_filters_classifies_and_aggregates():
    curves = parse_rates_csv(FIXTURE_CSV, 1_700_000_000_000)
    by_key = {c.key: c for c in curves}
    assert set(by_key) == {"sofr", "cpi"}

    sofr = by_key["sofr"]
    assert sofr.obs_date == 1_700_000_000_000
    assert [p.tenor_label for p in sofr.points] == ["5Y", "10Y"]
    ten = next(p for p in sofr.points if p.tenor_label == "10Y")
    assert ten.trade_count == 2
    assert ten.rate_pct == pytest.approx(3.98204)
    assert ten.total_notional == 75_000_000.0
    five = next(p for p in sofr.points if p.tenor_label == "5Y")
    assert five.total_notional == 250_000_000.0  # capped value counted

    cpi = by_key["cpi"]
    assert [p.tenor_label for p in cpi.points] == ["1Y"]
    assert cpi.points[0].rate_pct == pytest.approx(3.235)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && ./.venv/bin/pytest tests/test_sdr.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.adapters.sdr'`.

- [ ] **Step 3: Create the pure functions**

Create `api/app/adapters/sdr.py`:

```python
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
from .base import Adapter, SourceUnavailable

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && ./.venv/bin/pytest tests/test_sdr.py -q`
Expected: PASS (all pure-function tests + the model test from Task 1).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/sdr.py api/tests/test_sdr.py
git commit -m "feat(api): SDR swap-tape normalization (classify/bucket/median)"
```

---

## Task 4: SDR adapter shell (fetch + unzip + walk-back) and registration

**Files:**
- Modify: `api/app/adapters/sdr.py`
- Modify: `api/app/deps.py`
- Test: `api/tests/test_sdr.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_sdr.py`:

```python
from app.adapters.sdr import SdrAdapter
from app.adapters.base import SourceUnavailable
from app.cache import cache


def test_get_swap_rates_walks_back_to_first_available(monkeypatch):
    cache._store.clear()
    today = datetime.now(timezone.utc).date()
    available = today - timedelta(days=1)  # today's file 404s; yesterday's exists

    async def fake_fetch(self, d):
        if d == available:
            return FIXTURE_CSV
        raise SourceUnavailable("sdr error (HTTP 404)")

    monkeypatch.setattr(SdrAdapter, "_fetch_csv", fake_fetch)

    curves = asyncio.run(SdrAdapter().get_swap_rates())
    by_key = {c.key: c for c in curves}
    assert set(by_key) == {"sofr", "cpi"}
    sofr = by_key["sofr"]
    assert [p.tenor_label for p in sofr.points] == ["5Y", "10Y"]
    expected_ms = int(
        datetime(available.year, available.month, available.day, tzinfo=timezone.utc).timestamp() * 1000
    )
    assert sofr.obs_date == expected_ms


def test_get_swap_rates_raises_when_no_file_in_window(monkeypatch):
    cache._store.clear()

    async def fake_fetch(self, d):
        raise SourceUnavailable("sdr error (HTTP 404)")

    monkeypatch.setattr(SdrAdapter, "_fetch_csv", fake_fetch)
    with pytest.raises(SourceUnavailable):
        asyncio.run(SdrAdapter().get_swap_rates())


def test_fetch_csv_unzips_in_memory(monkeypatch):
    cache._store.clear()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("CFTC_CUMULATIVE_RATES_2025_05_29.csv", FIXTURE_CSV)
    zip_bytes = buf.getvalue()

    async def fake_get_bytes(url, *, source, **kwargs):
        assert source == "sdr"
        assert url.endswith("CFTC_CUMULATIVE_RATES_2025_05_29.zip")
        return zip_bytes

    monkeypatch.setattr("app.adapters.sdr.get_bytes", fake_get_bytes)
    text = asyncio.run(SdrAdapter()._fetch_csv(date(2025, 5, 29)))
    assert "USD-SOFR-OIS Compound" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && ./.venv/bin/pytest tests/test_sdr.py -k "swap_rates or fetch_csv" -q`
Expected: FAIL — `AttributeError: type object 'SdrAdapter' has no attribute ...` / `cannot import name 'SdrAdapter'`.

- [ ] **Step 3: Add the adapter shell**

Append to `api/app/adapters/sdr.py`:

```python
class SdrAdapter(Adapter):
    name = "sdr"

    def _url(self, d: date) -> str:
        return f"{_BASE}/CFTC_CUMULATIVE_RATES_{d.strftime('%Y_%m_%d')}.zip"

    async def _fetch_csv(self, d: date) -> str:
        """Fetch the day's ZIP and return its single CSV member as text.
        A missing file surfaces as SourceUnavailable (S3 404) via get_bytes."""
        content = await get_bytes(self._url(d), source="sdr")
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            member = zf.namelist()[0]
            with zf.open(member) as fh:
                return fh.read().decode("utf-8", errors="replace")

    async def get_swap_rates(self) -> list[SwapCurve]:
        """Latest available EOD file: walk back from today (UTC) until a file is
        found, parse SOFR + US CPI rate-by-tenor, cache the result per file date."""
        today = datetime.now(timezone.utc).date()
        last_exc: Exception | None = None
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
            except SourceUnavailable as exc:
                last_exc = exc
                continue
        raise last_exc or SourceUnavailable("sdr: no recent RATES file found")
```

Note: `build` binds `d`/`obs_ms` via default args so each loop iteration captures its own values (avoids the classic late-binding closure bug).

- [ ] **Step 4: Register the adapter**

In `api/app/deps.py`, add the import alongside the others and register it:

```python
from .adapters.sdr import SdrAdapter
```

and, after `registry.register(PeopleAdapter())` (around line 26):

```python
registry.register(SdrAdapter())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && ./.venv/bin/pytest tests/test_sdr.py -q`
Expected: PASS (all SDR tests).

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/sdr.py api/app/deps.py api/tests/test_sdr.py
git commit -m "feat(api): SDR adapter fetch/unzip/walk-back + registry registration"
```

---

## Task 5: `GET /swaps` route

**Files:**
- Modify: `api/app/routers.py`
- Test: `api/tests/test_routers.py`

- [ ] **Step 1: Write the failing tests**

In `api/tests/test_routers.py`, add the import for the swap models to the existing `from app.models import ...` line:

```python
from app.models import MarginSummary, Position, SwapCurve, SwapTenorPoint
```

Then append:

```python
def test_swaps_ok(monkeypatch):
    sdr = get_registry().get("sdr")

    async def _rates():
        return [
            SwapCurve(
                key="sofr", label="SOFR OIS", obs_date=1_700_000_000_000,
                points=[SwapTenorPoint(tenor_label="10Y", tenor_years=10.0, rate_pct=3.98,
                                       trade_count=2, total_notional=75_000_000.0)],
            ),
            SwapCurve(key="cpi", label="US CPI (zero-coupon)", obs_date=1_700_000_000_000, points=[]),
        ]

    monkeypatch.setattr(sdr, "get_swap_rates", _rates)
    r = client.get("/swaps")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["fileDate"] == 1_700_000_000_000
    sofr = next(c for c in body["curves"] if c["key"] == "sofr")
    assert sofr["points"][0]["tenorLabel"] == "10Y"
    assert sofr["points"][0]["totalNotional"] == 75_000_000.0


def test_swaps_empty_when_no_points(monkeypatch):
    sdr = get_registry().get("sdr")

    async def _rates():
        return [
            SwapCurve(key="sofr", label="SOFR OIS", obs_date=1_700_000_000_000, points=[]),
            SwapCurve(key="cpi", label="US CPI (zero-coupon)", obs_date=1_700_000_000_000, points=[]),
        ]

    monkeypatch.setattr(sdr, "get_swap_rates", _rates)
    r = client.get("/swaps")
    assert r.json()["status"] == "empty"


def test_swaps_maps_source_down(monkeypatch):
    from app.adapters.base import SourceUnavailable
    sdr = get_registry().get("sdr")

    async def _rates():
        raise SourceUnavailable("no recent file")

    monkeypatch.setattr(sdr, "get_swap_rates", _rates)
    r = client.get("/swaps")
    assert r.json()["status"] == "source_down"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && ./.venv/bin/pytest tests/test_routers.py -k swaps -q`
Expected: FAIL — 404 (route missing), so `assert r.status_code == 200` / status assertions fail.

- [ ] **Step 3: Add the route**

In `api/app/routers.py`, add `SwapsResponse` to the `from .models import (...)` block (keep alphabetical-ish ordering near `StatusResponse`):

```python
    SwapsResponse,
```

Then, after the `yield_curve` endpoint (around line 224), add:

```python
# --------------------------------------------------------------------------- #
# swaps → CFTC SDR (DTCC public dissemination). EOD SOFR + US CPI rate-by-tenor.
# --------------------------------------------------------------------------- #
@router.get("/swaps", response_model=SwapsResponse, tags=["macro"])
async def swaps() -> SwapsResponse:
    adapter = _adapter("sdr")
    if adapter is None:
        return SwapsResponse(status=SourceStatus.SOURCE_DOWN, message="sdr integration not available.")
    try:
        curves = await adapter.get_swap_rates()
    except Exception as exc:  # noqa: BLE001 — mapped to a UI state, never crashes
        status, msg = _status_from_exc(exc)
        return SwapsResponse(status=status, message=msg)
    file_date = next((c.obs_date for c in curves), None)
    status = SourceStatus.OK if any(c.points for c in curves) else SourceStatus.EMPTY
    return SwapsResponse(status=status, file_date=file_date, curves=curves)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && ./.venv/bin/pytest tests/test_routers.py -k swaps -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full backend suite + lint**

Run: `cd api && ./.venv/bin/pytest -q && ./.venv/bin/ruff check app tests`
Expected: all pass, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add api/app/routers.py api/tests/test_routers.py
git commit -m "feat(api): GET /swaps route over the SDR adapter"
```

---

## Task 6: Regenerate the frontend OpenAPI types

**Files:**
- Modify: `web/app/lib/api/schema.ts` (generated)

- [ ] **Step 1: Start the backend**

Run (from the worktree root, in a background shell):

```bash
cd api && ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
```

Wait ~2s, then confirm it serves the new schema:

```bash
curl -s http://127.0.0.1:8000/openapi.json | grep -o '"SwapsResponse"' | head -1
```

Expected: prints `"SwapsResponse"`.

- [ ] **Step 2: Regenerate types**

Run: `cd web && npm run gen:api`
Expected: `app/lib/api/schema.ts` rewritten with no errors.

- [ ] **Step 3: Verify the new types landed**

Run: `grep -c "SwapsResponse\|SwapCurve\|SwapTenorPoint" web/app/lib/api/schema.ts`
Expected: a non-zero count (≥3).

- [ ] **Step 4: Stop the backend**

Run: `kill %1` (or the uvicorn PID). Confirm port freed.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate OpenAPI types for /swaps"
```

---

## Task 7: Command parsing (parser, types, tabs) + tests

**Files:**
- Modify: `web/app/lib/command/types.ts`
- Modify: `web/app/lib/command/parser.ts`
- Modify: `web/app/lib/command/tabs.ts`
- Test: `web/app/lib/command/parser.test.ts`, `web/app/lib/command/tabs.test.ts`

- [ ] **Step 1: Write the failing tests**

In `web/app/lib/command/parser.test.ts`, add inside the `describe` block:

```typescript
  it("parses argless `swaps`", () => {
    expect(parseCommand("swaps")).toEqual({ kind: "swaps" });
    expect(parseCommand("  SWAPS ")).toEqual({ kind: "swaps" });
  });
```

In `web/app/lib/command/tabs.test.ts`, add inside the singleton-commands test (or a new `it`):

```typescript
  it("maps swaps to the singleton swaps tab", () => {
    expect(tabFor("swaps")).toMatchObject({ id: "swaps", widget: "swaps", title: "Swaps" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run app/lib/command`
Expected: FAIL — `swaps` parses to an `error` command / tab is `null`.

- [ ] **Step 3: Extend the types**

In `web/app/lib/command/types.ts`, add `swaps` to the `Command` union (after the `cal` entry, line 8):

```typescript
  | { kind: "swaps" }
```

and add `"swaps"` to the `WidgetKind` union (after `"cal"`, line 25):

```typescript
  | "swaps"
```

- [ ] **Step 4: Extend the parser**

In `web/app/lib/command/parser.ts`, add a case after `case "yield":` (line 31-32):

```typescript
    case "swaps":
      return { kind: "swaps" };
```

- [ ] **Step 5: Extend tabs**

In `web/app/lib/command/tabs.ts`, add a case after the `yield` case (line 19-20):

```typescript
    case "swaps":
      return { id: "swaps", widget: "swaps", title: "Swaps" };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npx vitest run app/lib/command`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/app/lib/command/types.ts web/app/lib/command/parser.ts web/app/lib/command/tabs.ts web/app/lib/command/parser.test.ts web/app/lib/command/tabs.test.ts
git commit -m "feat(web): parse `swaps` command and map it to a tab"
```

---

## Task 8: Loader + client type re-exports

**Files:**
- Modify: `web/app/lib/loaders.ts`
- Modify: `web/app/lib/api/client.ts`

- [ ] **Step 1: Add convenience type re-exports**

In `web/app/lib/api/client.ts`, after `export type FollowItem = ...` (last re-export line), add:

```typescript
export type SwapsResponse = Schemas["SwapsResponse"];
export type SwapCurve = Schemas["SwapCurve"];
export type SwapTenorPoint = Schemas["SwapTenorPoint"];
```

- [ ] **Step 2: Add the loader**

In `web/app/lib/loaders.ts`, after `loadYield` (around line 57), add:

```typescript
export async function loadSwaps(): Promise<Schemas["SwapsResponse"]> {
  const { data, error } = await api.GET("/swaps", {});
  return unwrap(data, error);
}
```

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/lib/api/client.ts web/app/lib/loaders.ts
git commit -m "feat(web): loadSwaps loader + swap type re-exports"
```

---

## Task 9: SwapsWidget + host wiring + help entry

**Files:**
- Create: `web/app/widgets/SwapsWidget.tsx`
- Modify: `web/app/components/WidgetHost.tsx`
- Modify: `web/app/widgets/HelpWidget.tsx`

- [ ] **Step 1: Create the widget**

Create `web/app/widgets/SwapsWidget.tsx`:

```tsx
"use client";
import { WidgetFrame, ResourceView, fmt } from "../components/ui";
import { loadSwaps } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import type { Schemas } from "../lib/api/client";

type SwapCurve = Schemas["SwapCurve"];

const th: React.CSSProperties = { textAlign: "left", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const thr: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "0.3rem 0.6rem" };
const tdr: React.CSSProperties = { ...td, textAlign: "right" };

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtNotional(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  return `$${n.toLocaleString()}`;
}

function CurveTable({ curve }: { curve: SwapCurve }) {
  return (
    <div style={{ marginBottom: "1.2rem" }}>
      <strong>{curve.label}</strong>
      {curve.points.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: "0.3rem 0" }}>No prints in this file.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.4rem" }}>
          <thead>
            <tr>
              <th style={th}>Tenor</th>
              <th style={thr}>Rate %</th>
              <th style={thr}>Trades</th>
              <th style={thr}>Notional</th>
            </tr>
          </thead>
          <tbody>
            {curve.points.map((p) => (
              <tr key={p.tenorLabel} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{p.tenorLabel}</td>
                <td style={tdr}>{fmt(p.ratePct)}</td>
                <td style={tdr}>{p.tradeCount}</td>
                <td style={tdr}>{fmtNotional(p.totalNotional)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SwapsWidget() {
  const { state, refresh } = useResource(loadSwaps);
  return (
    <WidgetFrame
      title="Swaps"
      source="CFTC SDR (DTCC)"
      onRefresh={refresh}
      busy={state.kind === "loading"}
    >
      <ResourceView state={state}>
        {(data) => (
          <div>
            <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "0 0 0.9rem" }}>
              EOD file {fmtDate(data.fileDate)} · median fixed rate per tenor from anonymized,
              capped SDR prints — not a benchmark rate.
            </p>
            {(data.curves ?? []).map((c) => (
              <CurveTable key={c.key} curve={c} />
            ))}
          </div>
        )}
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Wire it into the host**

In `web/app/components/WidgetHost.tsx`, add the import after the other widget imports (line 14):

```tsx
import SwapsWidget from "../widgets/SwapsWidget";
```

and a case after `case "yield":` (line 27-28):

```tsx
    case "swaps":
      return <SwapsWidget />;
```

- [ ] **Step 3: Add the help entry**

In `web/app/widgets/HelpWidget.tsx`, add to the `COMMANDS` array after the `yield` line (line 9):

```typescript
  ["swaps", "SOFR & US CPI swap rates by tenor (CFTC SDR via DTCC)"],
```

- [ ] **Step 4: Type-check, lint, and build**

Run: `cd web && npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors, no lint errors, successful production build.

- [ ] **Step 5: Run the frontend test suite**

Run: `cd web && npm test`
Expected: all tests pass (including the new parser/tabs tests).

- [ ] **Step 6: Commit**

```bash
git add web/app/widgets/SwapsWidget.tsx web/app/components/WidgetHost.tsx web/app/widgets/HelpWidget.tsx
git commit -m "feat(web): SwapsWidget (SOFR + US CPI rate-by-tenor) + host/help wiring"
```

---

## Task 10: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Backend suite + lint (clean run)**

Run: `cd api && ./.venv/bin/pytest -q && ./.venv/bin/ruff check app tests`
Expected: all pass.

- [ ] **Step 2: Frontend suite + build**

Run: `cd web && npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 3: Live smoke test (real DTCC fetch)**

Start the backend, then hit the live endpoint (this makes a real network call to DTCC's public S3 — confirms the URL pattern, unzip, and parse against a real file):

```bash
cd api && ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
sleep 2
curl -s http://127.0.0.1:8000/swaps | python3 -m json.tool | head -40
kill %1
```

Expected: a JSON body with `"status": "ok"`, a `fileDate`, and `curves` containing `sofr` and `cpi` with non-empty `points` (tenor labels, ratePct, tradeCount, totalNotional). If `status` is `source_down`, the most recent few UTC days may have no published file yet (e.g. a long holiday weekend) — widen `_WALKBACK_DAYS` temporarily to confirm, then revert.

- [ ] **Step 4: Manual UI check (optional but recommended)**

Start backend (`:8000`) and `cd web && npm run dev` (`:3000`). In the browser, type `swaps` in the command bar. Expect a "Swaps" tab with a date sub-note and two tables (SOFR OIS, US CPI). Click `refresh`. Type `help` and confirm `swaps` is listed. Confirm there is **no** auto-refresh toggle on the widget.

- [ ] **Step 5: Update memory**

Add a one-line entry to `/home/brian/.claude/projects/-home-brian-omphalos/memory/MEMORY.md` and a `swaps-sdr-feature.md` memory noting the feature is implemented on branch `worktree-swaps-sdr` (data source: DTCC public CFTC RATES file; SOFR + US CPI; EOD, no auto-refresh).

- [ ] **Step 6: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide how to integrate (PR off `origin/main` per the worktree workflow — do NOT local-merge into `main`).

---

## Self-Review Notes

- **Spec coverage:** data source + URL (Task 4), classification strings (Task 3 `classify_underlier`), 110-col CSV field usage (Task 3 `parse_rates_csv`), canonical models (Task 1), `GET /swaps` + status mapping (Task 5), generated types (Task 6), command/tab/loader/widget/help (Tasks 7–9), no auto-refresh (Task 9 — `WidgetFrame` called without `autoRefresh`), all error states (via shared `ResourceView`/`_status_from_exc`), caveats sub-note (Task 9), tests incl. capped/basis/non-USD/MODI exclusions (Task 3 fixture). All covered.
- **Frontend widget render test:** the repo has **no** existing widget-level render test harness (only `lib/` unit tests), so per existing patterns this plan tests command/tab logic and relies on `tsc`/`build` + the live smoke test for the widget — rather than introducing a new React testing-library setup (YAGNI). Noted as a deliberate deviation from the spec's "render test" line.
- **Type consistency:** `get_swap_rates()`, `SwapCurve`/`SwapTenorPoint`/`SwapsResponse`, field names (`tenorLabel`/`ratePct`/`tradeCount`/`totalNotional`/`fileDate`/`obsDate`), `key` values `sofr`/`cpi`, and the `sdr` adapter name are used identically across every task.
