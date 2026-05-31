# Yield Curve History & BP-Change Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `yield` widget from a single latest curve to multiple as-of curves (relative period or exact date) overlaid on a chart, with per-tenor basis-point change columns measured `current − comparison`, controlled via a settings popover.

**Architecture:** The FRED adapter fetches a rolling ~13-month daily history once (cached), then resolves any requested as-of date in memory by picking the latest valid observation on or before the target. The `/yield` endpoint returns a list of `AsOfCurve` objects (current + six relative presets + any exact dates passed via repeated `asof` query params). The frontend computes Δs as a pure util and renders a multi-line SVG + dynamic Δ table; user toggles persist to `localStorage`.

**Tech Stack:** FastAPI + Pydantic (camelCase models), pytest. Next.js + React + TypeScript, openapi-typescript / openapi-fetch generated client, vitest.

**Reference:** Spec at `docs/superpowers/specs/2026-05-30-yield-curve-history-design.md`. Per-source rules in `.claude/rules/fred-and-news.md`. Type-contract rule (CLAUDE.md): Pydantic is source of truth; TS types are generated, never hand-written.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `api/app/models.py` | Add `AsOfCurve`; revise `YieldCurveResponse` (drop `points`, add `curves`). |
| `api/app/adapters/fred.py` | Pure helpers (`parse_observations`, `latest_on_or_before`, `relative_target`), history fetch + cache, `resolve_as_of`, rewritten `get_yield_curve(asof_dates)`. |
| `api/app/routers.py` | `parse_asof_dates` helper; `/yield` accepts repeated `asof` params; builds the envelope. |
| `api/tests/test_fred.py` | Extend with tests for the new pure helpers + `resolve_as_of` + `get_yield_curve`. |
| `web/app/lib/api/schema.ts` | Regenerated from OpenAPI. |
| `web/app/lib/yieldDelta.ts` | Pure `computeDeltaBp`. |
| `web/app/lib/yieldDelta.test.ts` | Tests for `computeDeltaBp`. |
| `web/app/lib/yieldPrefs.ts` | Prefs model, defaults, pure mutators, localStorage load/save. |
| `web/app/lib/yieldPrefs.test.ts` | Tests for the pure mutators. |
| `web/app/components/ui.tsx` | Add optional `headerExtra` slot to `WidgetFrame`. |
| `web/app/lib/loaders.ts` | `loadYield(asof[])`. |
| `web/app/widgets/YieldWidget.tsx` | Multi-line chart, legend, settings popover, Δ table. |

---

## Task 1: Backend models — `AsOfCurve` + revised `YieldCurveResponse`

**Files:**
- Modify: `api/app/models.py` (the `YieldPoint` block ~line 139 and `YieldCurveResponse` ~line 184)
- Test: `api/tests/test_fred.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_fred.py`:

```python
from app.models import AsOfCurve, YieldPoint, YieldCurveResponse, SourceStatus


def test_asofcurve_serializes_camelcase():
    c = AsOfCurve(
        key="1w",
        label="1W ago",
        requested_date=1717718400000,
        obs_date=1717632000000,
        points=[YieldPoint(tenor_label="10Y", tenor_years=10.0, rate_pct=4.43, obs_date=1717632000000)],
    )
    dumped = c.model_dump(by_alias=True)
    assert dumped["requestedDate"] == 1717718400000
    assert dumped["obsDate"] == 1717632000000
    assert dumped["points"][0]["tenorLabel"] == "10Y"


def test_yieldcurveresponse_holds_curves():
    r = YieldCurveResponse(status=SourceStatus.OK, curves=[])
    assert r.model_dump(by_alias=True)["curves"] == []
    assert not hasattr(r, "points")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_fred.py::test_asofcurve_serializes_camelcase -v`
Expected: FAIL with `ImportError: cannot import name 'AsOfCurve'`.

- [ ] **Step 3: Add the model and revise the envelope**

In `api/app/models.py`, just after the `YieldPoint` class, add:

```python
class AsOfCurve(CamelModel):
    """A yield curve as of one observation date (latest, a relative lookback, or
    an exact calendar date). `obs_date` is the most recent per-tenor observation
    actually used; `requested_date` is the target as-of date."""

    key: str
    label: str
    requested_date: int
    obs_date: int
    points: list[YieldPoint] = []
```

Replace the existing `YieldCurveResponse` body:

```python
class YieldCurveResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    curves: list[AsOfCurve] = []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_fred.py -v`
Expected: the two new tests PASS. (The existing `get_yield_curve`-dependent code may not yet import — that's fine; `routers.py` is fixed in Task 4. If `pytest` collection fails on an import elsewhere, proceed; Tasks 3–4 restore consistency.)

- [ ] **Step 5: Commit**

```bash
git add api/app/models.py api/tests/test_fred.py
git commit -m "feat(api): add AsOfCurve model; YieldCurveResponse carries curves"
```

---

## Task 2: FRED pure helpers — `parse_observations`, `latest_on_or_before`, `relative_target`

**Files:**
- Modify: `api/app/adapters/fred.py`
- Test: `api/tests/test_fred.py`

- [ ] **Step 1: Write the failing tests**

Add to `api/tests/test_fred.py`:

```python
from app.adapters.fred import (
    parse_observations,
    latest_on_or_before,
    relative_target,
    fred_date_to_ms,
)


def test_parse_observations_sorts_ascending_and_drops_dots():
    payload = {
        "observations": [
            {"date": "2024-06-07", "value": "4.43"},
            {"date": "2024-06-10", "value": "."},      # dropped
            {"date": "2024-06-06", "value": "4.40"},
        ]
    }
    series = parse_observations(payload)
    assert series == [
        (fred_date_to_ms("2024-06-06"), 4.40),
        (fred_date_to_ms("2024-06-07"), 4.43),
    ]


def test_latest_on_or_before_picks_latest_not_after_target():
    series = [
        (fred_date_to_ms("2024-06-03"), 4.30),
        (fred_date_to_ms("2024-06-05"), 4.35),
        (fred_date_to_ms("2024-06-07"), 4.43),
    ]
    # Target is a weekend (06-08) -> latest on/before is Friday 06-07
    assert latest_on_or_before(series, fred_date_to_ms("2024-06-08")) == (
        fred_date_to_ms("2024-06-07"),
        4.43,
    )
    # Exact hit
    assert latest_on_or_before(series, fred_date_to_ms("2024-06-05")) == (
        fred_date_to_ms("2024-06-05"),
        4.35,
    )
    # Before the series start -> None
    assert latest_on_or_before(series, fred_date_to_ms("2024-06-01")) is None


def test_relative_target_day_week_month_year():
    cur = fred_date_to_ms("2024-06-07")
    assert relative_target(cur, "1d") == fred_date_to_ms("2024-06-06")
    assert relative_target(cur, "1w") == fred_date_to_ms("2024-05-31")
    assert relative_target(cur, "1m") == fred_date_to_ms("2024-05-07")
    assert relative_target(cur, "3m") == fred_date_to_ms("2024-03-07")
    assert relative_target(cur, "1y") == fred_date_to_ms("2023-06-07")


def test_relative_target_clamps_short_month():
    # 2024-03-31 minus 1 month -> Feb has no 31st -> clamp to 2024-02-29
    cur = fred_date_to_ms("2024-03-31")
    assert relative_target(cur, "1m") == fred_date_to_ms("2024-02-29")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_fred.py -k "parse_observations or latest_on_or_before or relative_target" -v`
Expected: FAIL with `ImportError` for the new names.

- [ ] **Step 3: Implement the helpers**

In `api/app/adapters/fred.py`, update the imports near the top:

```python
import calendar
from datetime import datetime, timedelta, timezone
```

Add these pure functions after `latest_valid_observation` (keep `latest_valid_observation` — still used by nothing after Task 3, so delete it in Task 3):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_fred.py -k "parse_observations or latest_on_or_before or relative_target" -v`
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/fred.py api/tests/test_fred.py
git commit -m "feat(fred): pure helpers for history parsing and as-of resolution"
```

---

## Task 3: FRED — history fetch, `resolve_as_of`, rewritten `get_yield_curve`

**Files:**
- Modify: `api/app/adapters/fred.py`
- Test: `api/tests/test_fred.py`

- [ ] **Step 1: Write the failing tests**

Add to `api/tests/test_fred.py`:

```python
from datetime import date

import pytest

from app.adapters.fred import resolve_as_of, FredAdapter


def _fake_history():
    # Two tenors with a few business days; 10Y has a gap on the latest day.
    return {
        "DGS1MO": [
            (fred_date_to_ms("2024-06-03"), 5.30),
            (fred_date_to_ms("2024-06-07"), 5.32),
        ],
        "DGS10": [
            (fred_date_to_ms("2024-06-03"), 4.40),
            (fred_date_to_ms("2024-06-06"), 4.43),  # no 06-07 obs for 10Y
        ],
    }


def test_resolve_as_of_aligns_by_tenor_and_uses_on_or_before():
    points = resolve_as_of(_fake_history(), fred_date_to_ms("2024-06-07"))
    by_label = {p.tenor_label: p for p in points}
    assert by_label["1M"].rate_pct == 5.32
    assert by_label["1M"].obs_date == fred_date_to_ms("2024-06-07")
    # 10Y has no 06-07 obs -> latest on/before is 06-06
    assert by_label["10Y"].rate_pct == 4.43
    assert by_label["10Y"].obs_date == fred_date_to_ms("2024-06-06")


def test_resolve_as_of_omits_tenor_with_no_data_in_range():
    points = resolve_as_of(_fake_history(), fred_date_to_ms("2024-06-01"))
    assert points == []  # target precedes every observation


@pytest.mark.asyncio
async def test_get_yield_curve_builds_current_and_presets(monkeypatch):
    adapter = FredAdapter()
    # Stub the network/cache layer: feed a fixed history.
    async def fake_history(self, start_ms):  # noqa: ARG001
        return _fake_history()

    monkeypatch.setattr(FredAdapter, "_history", fake_history)
    monkeypatch.setattr(FredAdapter, "_api_key", lambda self: "test-key")

    curves = await adapter.get_yield_curve([])
    keys = [c.key for c in curves]
    assert keys[0] == "current"
    assert keys[1:] == ["1d", "1w", "1m", "3m", "6m", "1y"]
    current = curves[0]
    assert current.label == "Today"
    # current uses the latest available date across series (2024-06-07)
    assert current.requested_date == fred_date_to_ms("2024-06-07")
    assert {p.tenor_label for p in current.points} == {"1M", "10Y"}


@pytest.mark.asyncio
async def test_get_yield_curve_appends_exact_dates(monkeypatch):
    adapter = FredAdapter()

    async def fake_history(self, start_ms):  # noqa: ARG001
        return _fake_history()

    monkeypatch.setattr(FredAdapter, "_history", fake_history)
    monkeypatch.setattr(FredAdapter, "_api_key", lambda self: "test-key")

    curves = await adapter.get_yield_curve([date(2024, 6, 6)])
    exact = curves[-1]
    assert exact.key == "2024-06-06"
    assert exact.requested_date == fred_date_to_ms("2024-06-06")
    by_label = {p.tenor_label: p for p in exact.points}
    assert by_label["10Y"].rate_pct == 4.43
```

Note: check whether `pytest-asyncio` is configured. Run `cd api && grep -rn "asyncio_mode\|pytest-asyncio\|anyio" pyproject.toml setup.cfg pytest.ini tox.ini 2>/dev/null` and look at an existing async test (e.g. `grep -rln "async def test" tests/`). If async tests already run in this repo, match their decorator/marker style instead of `@pytest.mark.asyncio`. If none exist and `pytest-asyncio` is absent, make the two async tests synchronous by wrapping with `asyncio.run(...)`:

```python
import asyncio

def test_get_yield_curve_builds_current_and_presets(monkeypatch):
    ...
    curves = asyncio.run(adapter.get_yield_curve([]))
    ...
```

Use whichever form matches the repo; the assertions are identical.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/test_fred.py -k "resolve_as_of or get_yield_curve" -v`
Expected: FAIL with `ImportError` for `resolve_as_of` / missing `_history`.

- [ ] **Step 3: Implement history fetch, resolution, and curve assembly**

In `api/app/adapters/fred.py`:

Update model import and add constants near the top:

```python
from datetime import date  # add to the datetime import line if preferred
from ..models import AsOfCurve, YieldPoint
```

Replace `_CURVE_TTL` block / add:

```python
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
```

Delete the now-unused `latest_valid_observation` function (superseded by `parse_observations` + `latest_on_or_before`).

Add the resolution helper (pure) near the other pure helpers:

```python
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
```

Replace the `_fetch_series` and `get_yield_curve` methods on `FredAdapter` with:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && python -m pytest tests/test_fred.py -v`
Expected: all FRED tests PASS (old `latest_valid_observation` tests were for a now-deleted function — delete those two tests, `test_latest_valid_observation_*`, if they still reference it).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/fred.py api/tests/test_fred.py
git commit -m "feat(fred): rolling history fetch + multi as-of curve assembly"
```

---

## Task 4: Router — `/yield` accepts `asof` params

**Files:**
- Modify: `api/app/routers.py` (imports + `/yield` route ~line 183)
- Test: `api/tests/test_fred.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_fred.py`:

```python
from app.routers import parse_asof_dates


def test_parse_asof_dates_valid_and_invalid():
    dates, error = parse_asof_dates(["2024-06-06", "2024-01-15"])
    assert error is None
    assert [d.isoformat() for d in dates] == ["2024-06-06", "2024-01-15"]

    dates, error = parse_asof_dates(["not-a-date"])
    assert dates == []
    assert error is not None and "not-a-date" in error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_fred.py::test_parse_asof_dates_valid_and_invalid -v`
Expected: FAIL with `ImportError: cannot import name 'parse_asof_dates'`.

- [ ] **Step 3: Implement the helper and rewire the route**

In `api/app/routers.py`, add to imports:

```python
from datetime import date

from fastapi import APIRouter, Query  # add Query if not already imported
```

Add the pure helper near `_status_from_exc`:

```python
def parse_asof_dates(asof: list[str]) -> tuple[list[date], str | None]:
    """Pure: parse repeated `asof=YYYY-MM-DD` query params. Returns (dates, error);
    on the first malformed value, returns ([], message)."""
    out: list[date] = []
    for raw in asof:
        try:
            out.append(date.fromisoformat(raw))
        except ValueError:
            return [], f"invalid asof date: {raw!r} (expected YYYY-MM-DD)"
    return out, None
```

Replace the `/yield` route body:

```python
@router.get("/yield", response_model=YieldCurveResponse, tags=["macro"])
async def yield_curve(asof: list[str] = Query(default=[])) -> YieldCurveResponse:
    adapter = _adapter("fred")
    if adapter is None:
        return YieldCurveResponse(status=SourceStatus.SOURCE_DOWN, message="fred integration not available.")
    dates, error = parse_asof_dates(asof)
    if error is not None:
        return YieldCurveResponse(status=SourceStatus.EMPTY, message=error)
    try:
        curves = await adapter.get_yield_curve(dates)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return YieldCurveResponse(status=status, message=msg)
    status = SourceStatus.OK if any(c.points for c in curves) else SourceStatus.EMPTY
    return YieldCurveResponse(status=status, curves=curves)
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd api && python -m pytest -v`
Expected: all tests PASS (collection succeeds — `routers.py` no longer references the removed `points` kwarg).

- [ ] **Step 5: Commit**

```bash
git add api/app/routers.py api/tests/test_fred.py
git commit -m "feat(api): /yield accepts repeated asof params, returns curves"
```

---

## Task 5: Regenerate the TypeScript schema

**Files:**
- Modify: `web/app/lib/api/schema.ts` (generated — do not hand-edit)

- [ ] **Step 1: Start the backend**

Run (in a separate shell): `cd api && uvicorn app.main:app --host 127.0.0.1 --port 8000`
(Use the repo's documented dev command if different — check `api/README.md`.)

- [ ] **Step 2: Regenerate types**

Run: `cd web && npm run gen:api`
Expected: `web/app/lib/api/schema.ts` updates — `YieldCurveResponse` now has `curves: AsOfCurve[]` and a new `AsOfCurve` component; the old `points` field on the response is gone.

- [ ] **Step 3: Verify the build now fails on the old shape**

Run: `cd web && npx tsc --noEmit`
Expected: a type error in `YieldWidget.tsx` referencing `data.points` (confirms the type contract caught the change). This is expected — Task 10 fixes the widget.

- [ ] **Step 4: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate API types for yield curves"
```

---

## Task 6: Frontend pure util — `computeDeltaBp`

**Files:**
- Create: `web/app/lib/yieldDelta.ts`
- Test: `web/app/lib/yieldDelta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/yieldDelta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDeltaBp } from "./yieldDelta";
import type { YieldPoint } from "./api/client";

const p = (tenorLabel: string, ratePct: number): YieldPoint => ({
  tenorLabel,
  tenorYears: 0,
  ratePct,
  obsDate: 0,
});

describe("computeDeltaBp", () => {
  it("returns signed basis points = (current - comparison) * 100", () => {
    const out = computeDeltaBp([p("2Y", 4.50), p("10Y", 4.30)], [p("2Y", 4.40), p("10Y", 4.45)]);
    expect(out["2Y"]).toBe(10); // +0.10% = +10bp
    expect(out["10Y"]).toBe(-15); // -0.15% = -15bp
  });

  it("yields null when a tenor is missing on the comparison side", () => {
    const out = computeDeltaBp([p("2Y", 4.50), p("30Y", 4.70)], [p("2Y", 4.40)]);
    expect(out["2Y"]).toBe(10);
    expect(out["30Y"]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/yieldDelta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

Create `web/app/lib/yieldDelta.ts`:

```ts
import type { YieldPoint } from "./api/client";

// Per-tenor basis-point change of the current curve vs a comparison curve:
// (currentRatePct - comparisonRatePct) * 100, rounded to 0.1bp. Aligned by
// tenorLabel; null where the tenor is absent on either side. Pure/testable.
export function computeDeltaBp(
  current: YieldPoint[],
  comparison: YieldPoint[],
): Record<string, number | null> {
  const past = new Map(comparison.map((c) => [c.tenorLabel, c.ratePct]));
  const out: Record<string, number | null> = {};
  for (const cur of current) {
    const prior = past.get(cur.tenorLabel);
    out[cur.tenorLabel] =
      prior === undefined ? null : Math.round((cur.ratePct - prior) * 100 * 10) / 10;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/yieldDelta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/yieldDelta.ts web/app/lib/yieldDelta.test.ts
git commit -m "feat(web): computeDeltaBp pure util"
```

---

## Task 7: Frontend prefs — `yieldPrefs` model, defaults, mutators

**Files:**
- Create: `web/app/lib/yieldPrefs.ts`
- Test: `web/app/lib/yieldPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/yieldPrefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_YIELD_PREFS,
  compareKey,
  exactDates,
  toggleChart,
  toggleDelta,
  addExactDate,
  removeCompare,
} from "./yieldPrefs";

describe("yieldPrefs", () => {
  it("default: current + 1w on chart, all six relative deltas shown", () => {
    expect(DEFAULT_YIELD_PREFS.currentOnChart).toBe(true);
    const onChart = DEFAULT_YIELD_PREFS.compares.filter((c) => c.onChart).map(compareKey);
    expect(onChart).toEqual(["1w"]);
    const deltas = DEFAULT_YIELD_PREFS.compares.filter((c) => c.showDelta).map(compareKey);
    expect(deltas).toEqual(["1w", "1d", "1m", "3m", "6m", "1y"]);
  });

  it("toggleChart / toggleDelta flip the matching compare by key", () => {
    let prefs = toggleChart(DEFAULT_YIELD_PREFS, "1d");
    expect(prefs.compares.find((c) => compareKey(c) === "1d")?.onChart).toBe(true);
    prefs = toggleDelta(prefs, "1w");
    expect(prefs.compares.find((c) => compareKey(c) === "1w")?.showDelta).toBe(false);
  });

  it("addExactDate appends an exact compare (both toggles on); dedupes", () => {
    let prefs = addExactDate(DEFAULT_YIELD_PREFS, "2024-06-06");
    const added = prefs.compares.find((c) => compareKey(c) === "2024-06-06");
    expect(added).toMatchObject({ kind: "exact", date: "2024-06-06", onChart: true, showDelta: true });
    prefs = addExactDate(prefs, "2024-06-06"); // no duplicate
    expect(prefs.compares.filter((c) => compareKey(c) === "2024-06-06")).toHaveLength(1);
    expect(exactDates(prefs)).toEqual(["2024-06-06"]);
  });

  it("removeCompare drops the matching compare", () => {
    const prefs = removeCompare(DEFAULT_YIELD_PREFS, "1y");
    expect(prefs.compares.find((c) => compareKey(c) === "1y")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/yieldPrefs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `web/app/lib/yieldPrefs.ts`:

```ts
// Per-widget UI prefs for the yield curve: which comparison curves are drawn on
// the chart and which Δ columns show. Persisted to localStorage (non-secret UI
// state, CLAUDE.md). Mutators are pure; load/save are the only impure parts.

export type ComparePeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

export type CompareCurve =
  | { kind: "relative"; period: ComparePeriod; onChart: boolean; showDelta: boolean }
  | { kind: "exact"; date: string; onChart: boolean; showDelta: boolean };

export type YieldPrefs = {
  currentOnChart: boolean;
  compares: CompareCurve[];
};

export function compareKey(c: CompareCurve): string {
  return c.kind === "relative" ? c.period : c.date;
}

// Default: chart shows current + 1w; all six relative Δ columns shown.
export const DEFAULT_YIELD_PREFS: YieldPrefs = {
  currentOnChart: true,
  compares: [
    { kind: "relative", period: "1w", onChart: true, showDelta: true },
    { kind: "relative", period: "1d", onChart: false, showDelta: true },
    { kind: "relative", period: "1m", onChart: false, showDelta: true },
    { kind: "relative", period: "3m", onChart: false, showDelta: true },
    { kind: "relative", period: "6m", onChart: false, showDelta: true },
    { kind: "relative", period: "1y", onChart: false, showDelta: true },
  ],
};

function mapCompare(prefs: YieldPrefs, key: string, fn: (c: CompareCurve) => CompareCurve): YieldPrefs {
  return { ...prefs, compares: prefs.compares.map((c) => (compareKey(c) === key ? fn(c) : c)) };
}

export function toggleChart(prefs: YieldPrefs, key: string): YieldPrefs {
  return mapCompare(prefs, key, (c) => ({ ...c, onChart: !c.onChart }));
}

export function toggleDelta(prefs: YieldPrefs, key: string): YieldPrefs {
  return mapCompare(prefs, key, (c) => ({ ...c, showDelta: !c.showDelta }));
}

export function addExactDate(prefs: YieldPrefs, date: string): YieldPrefs {
  if (prefs.compares.some((c) => compareKey(c) === date)) return prefs;
  return {
    ...prefs,
    compares: [...prefs.compares, { kind: "exact", date, onChart: true, showDelta: true }],
  };
}

export function removeCompare(prefs: YieldPrefs, key: string): YieldPrefs {
  return { ...prefs, compares: prefs.compares.filter((c) => compareKey(c) !== key) };
}

// Exact dates to send as `asof` query params (relative curves need no param).
export function exactDates(prefs: YieldPrefs): string[] {
  return prefs.compares.filter((c): c is Extract<CompareCurve, { kind: "exact" }> => c.kind === "exact").map((c) => c.date);
}

const STORAGE_KEY = "omphalos.yield.prefs.v1";

export function loadYieldPrefs(): YieldPrefs {
  if (typeof window === "undefined") return DEFAULT_YIELD_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_YIELD_PREFS;
    const parsed = JSON.parse(raw) as Partial<YieldPrefs>;
    if (!Array.isArray(parsed.compares)) return DEFAULT_YIELD_PREFS;
    return {
      currentOnChart: typeof parsed.currentOnChart === "boolean" ? parsed.currentOnChart : true,
      compares: parsed.compares as CompareCurve[],
    };
  } catch {
    return DEFAULT_YIELD_PREFS;
  }
}

export function saveYieldPrefs(prefs: YieldPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/yieldPrefs.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/yieldPrefs.ts web/app/lib/yieldPrefs.test.ts
git commit -m "feat(web): yield curve prefs model + persistence"
```

---

## Task 8: `WidgetFrame` — optional `headerExtra` slot

**Files:**
- Modify: `web/app/components/ui.tsx` (`WidgetFrame` ~line 82)

- [ ] **Step 1: Add the prop**

In `web/app/components/ui.tsx`, change the `WidgetFrame` signature and header. Add `headerExtra` to the props type:

```tsx
export function WidgetFrame({
  title,
  source,
  onRefresh,
  busy,
  headerExtra,
  children,
}: {
  title: string;
  source?: string;
  onRefresh: () => void;
  busy: boolean;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
```

Replace the single refresh `<button>` with a flex group that renders `headerExtra` before it:

```tsx
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {headerExtra}
          <button
            onClick={onRefresh}
            disabled={busy}
            style={{
              background: "transparent",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0.3rem 0.7rem",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {busy ? "…" : "refresh"}
          </button>
        </div>
```

- [ ] **Step 2: Verify existing usage still type-checks**

Run: `cd web && npx tsc --noEmit`
Expected: no NEW errors from `ui.tsx` (the `headerExtra` prop is optional, so existing `WidgetFrame` callers are unaffected). The pre-existing `YieldWidget.tsx` `data.points` error from Task 5 may still show — that's fixed in Task 10.

- [ ] **Step 3: Commit**

```bash
git add web/app/components/ui.tsx
git commit -m "feat(web): WidgetFrame headerExtra slot"
```

---

## Task 9: Loader — `loadYield(asof[])`

**Files:**
- Modify: `web/app/lib/loaders.ts` (`loadYield` ~line 44)

- [ ] **Step 1: Update the loader**

In `web/app/lib/loaders.ts`, replace `loadYield`:

```ts
export async function loadYield(asof: string[] = []): Promise<Schemas["YieldCurveResponse"]> {
  const { data, error } = await api.GET("/yield", { params: { query: { asof } } });
  return unwrap(data, error);
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no NEW error in `loaders.ts` (the generated `/yield` operation now accepts an `asof` query array). The `YieldWidget.tsx` error remains until Task 10.

- [ ] **Step 3: Commit**

```bash
git add web/app/lib/loaders.ts
git commit -m "feat(web): loadYield passes asof query params"
```

---

## Task 10: `YieldWidget` — multi-line chart, legend, settings popover, Δ table

**Files:**
- Modify (full rewrite): `web/app/widgets/YieldWidget.tsx`

- [ ] **Step 1: Rewrite the widget**

Replace the entire contents of `web/app/widgets/YieldWidget.tsx` with:

```tsx
"use client";
import { useCallback, useMemo, useState } from "react";
import { fmt, ResourceView, WidgetFrame, signColor } from "../components/ui";
import { loadYield } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { computeDeltaBp } from "../lib/yieldDelta";
import {
  type YieldPrefs,
  type CompareCurve,
  DEFAULT_YIELD_PREFS,
  compareKey,
  exactDates,
  toggleChart,
  toggleDelta,
  addExactDate,
  removeCompare,
  loadYieldPrefs,
  saveYieldPrefs,
} from "../lib/yieldPrefs";
import type { Schemas, YieldPoint } from "../lib/api/client";

type AsOfCurve = Schemas["AsOfCurve"];

// Distinct colors for overlaid comparison curves (current uses --accent).
const PALETTE = ["#e0a458", "#5fb3b3", "#c08497", "#7b9e89", "#9a8fb3", "#b3915f"];

type RenderCurve = { key: string; label: string; color: string; points: YieldPoint[] };

// Multi-line SVG: x is tenor index (shared across curves via the union of tenor
// labels in current/widest curve); y is rate, normalized across all visible curves.
function CurveSvg({ curves, tenors }: { curves: RenderCurve[]; tenors: string[] }) {
  const W = 560;
  const H = 240;
  const pad = 36;
  const rates = curves.flatMap((c) => c.points.map((p) => p.ratePct));
  const min = rates.length ? Math.min(...rates) : 0;
  const max = rates.length ? Math.max(...rates) : 1;
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (tenors.length - 1 || 1);
  const y = (r: number) => H - pad - ((r - min) / span) * (H - 2 * pad);
  const idx = new Map(tenors.map((t, i) => [t, i]));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Treasury yield curves">
      {curves.map((c) => {
        const pts = c.points
          .filter((p) => idx.has(p.tenorLabel))
          .sort((a, b) => idx.get(a.tenorLabel)! - idx.get(b.tenorLabel)!);
        const path = pts
          .map((p, j) => `${j === 0 ? "M" : "L"} ${x(idx.get(p.tenorLabel)!).toFixed(1)} ${y(p.ratePct).toFixed(1)}`)
          .join(" ");
        return (
          <g key={c.key}>
            <path d={path} fill="none" stroke={c.color} strokeWidth={2} />
            {pts.map((p) => (
              <circle key={p.tenorLabel} cx={x(idx.get(p.tenorLabel)!)} cy={y(p.ratePct)} r={3} fill={c.color} />
            ))}
          </g>
        );
      })}
      {tenors.map((t, i) => (
        <text key={t} x={x(i)} y={H - pad + 16} fontSize={10} fill="var(--muted)" textAnchor="middle">
          {t}
        </text>
      ))}
    </svg>
  );
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

// Settings popover: per-compare Chart/Δ checkboxes + add-exact-date + reset.
function SettingsPopover({
  prefs,
  setPrefs,
  curvesByKey,
}: {
  prefs: YieldPrefs;
  setPrefs: (p: YieldPrefs) => void;
  curvesByKey: Map<string, AsOfCurve>;
}) {
  const [open, setOpen] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const cell: React.CSSProperties = { padding: "0.2rem 0.5rem", fontSize: "0.85rem" };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.3rem 0.7rem",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ⚙ curves
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.4rem)",
            zIndex: 10,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.6rem",
            minWidth: 240,
            boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                <th style={{ ...cell, textAlign: "left" }}>Curve</th>
                <th style={cell}>Chart</th>
                <th style={cell}>Δ</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={cell}>Today</td>
                <td style={{ ...cell, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={prefs.currentOnChart}
                    onChange={() => setPrefs({ ...prefs, currentOnChart: !prefs.currentOnChart })}
                  />
                </td>
                <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>ref</td>
                <td style={cell} />
              </tr>
              {prefs.compares.map((c) => {
                const key = compareKey(c);
                const resolved = curvesByKey.get(key);
                return (
                  <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}>
                      {c.kind === "relative" ? c.period.toUpperCase() : c.date}
                      {resolved && (
                        <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: "0.72rem" }}>
                          {fmtDate(resolved.obsDate)}
                        </span>
                      )}
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <input type="checkbox" checked={c.onChart} onChange={() => setPrefs(toggleChart(prefs, key))} />
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <input type="checkbox" checked={c.showDelta} onChange={() => setPrefs(toggleDelta(prefs, key))} />
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      {c.kind === "exact" && (
                        <button
                          onClick={() => setPrefs(removeCompare(prefs, key))}
                          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
                          aria-label={`remove ${key}`}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.6rem" }}>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.2rem 0.4rem",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => {
                if (dateInput) {
                  setPrefs(addExactDate(prefs, dateInput));
                  setDateInput("");
                }
              }}
              style={{
                background: "transparent",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.2rem 0.6rem",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              add
            </button>
          </div>
          <button
            onClick={() => setPrefs(DEFAULT_YIELD_PREFS)}
            style={{
              marginTop: "0.5rem",
              background: "transparent",
              color: "var(--muted)",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.8rem",
            }}
          >
            reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

export default function YieldWidget() {
  const [prefs, setPrefsState] = useState<YieldPrefs>(() => loadYieldPrefs());
  const setPrefs = useCallback((p: YieldPrefs) => {
    setPrefsState(p);
    saveYieldPrefs(p);
  }, []);

  const asof = exactDates(prefs);
  const asofKey = asof.join(",");
  const load = useCallback(() => loadYield(asof), [asofKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { state, refresh } = useResource(load);

  const settings = (
    <SettingsPopoverWrapper prefs={prefs} setPrefs={setPrefs} state={state} />
  );

  return (
    <WidgetFrame
      title="Treasury Yield Curve"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
    >
      <ResourceView state={state}>
        {(data) => {
          const curves = (data.curves ?? []) as AsOfCurve[];
          const byKey = new Map(curves.map((c) => [c.key, c]));
          const current = byKey.get("current");
          if (!current || current.points.length === 0) {
            return <p style={{ color: "var(--muted)" }}>No curve data.</p>;
          }
          const tenors = current.points.map((p) => p.tenorLabel);

          // Chart curves: current (if on) + each compare with onChart, colored.
          const chartCurves: RenderCurve[] = [];
          if (prefs.currentOnChart) {
            chartCurves.push({ key: "current", label: "Today", color: "var(--accent)", points: current.points });
          }
          prefs.compares.forEach((c: CompareCurve, i) => {
            if (!c.onChart) return;
            const resolved = byKey.get(compareKey(c));
            if (resolved) {
              chartCurves.push({
                key: resolved.key,
                label: resolved.label,
                color: PALETTE[i % PALETTE.length],
                points: resolved.points,
              });
            }
          });

          // Δ columns: each compare with showDelta that resolved to a curve.
          const deltaCols = prefs.compares
            .filter((c) => c.showDelta)
            .map((c) => byKey.get(compareKey(c)))
            .filter((c): c is AsOfCurve => Boolean(c))
            .map((c) => ({ curve: c, deltas: computeDeltaBp(current.points, c.points) }));

          return (
            <div>
              <CurveSvg curves={chartCurves} tenors={tenors} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", margin: "0.4rem 0 0.6rem" }}>
                {chartCurves.map((c) => (
                  <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem" }}>
                    <span style={{ width: 12, height: 2, background: c.color, display: "inline-block" }} />
                    {c.label}
                    <span style={{ color: "var(--muted)" }}>{fmtDate(byKey.get(c.key)?.obsDate ?? 0)}</span>
                  </span>
                ))}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Tenor</th>
                    <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Rate %</th>
                    {deltaCols.map(({ curve }) => (
                      <th key={curve.key} style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>
                        Δ {curve.label}
                        <div style={{ fontSize: "0.7rem" }}>{fmtDate(curve.obsDate)} (bp)</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current.points.map((p) => (
                    <tr key={p.tenorLabel} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.3rem 0.6rem" }}>{p.tenorLabel}</td>
                      <td style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>{fmt(p.ratePct)}</td>
                      {deltaCols.map(({ curve, deltas }) => {
                        const d = deltas[p.tenorLabel];
                        return (
                          <td key={curve.key} style={{ textAlign: "right", padding: "0.3rem 0.6rem", color: signColor(d) }}>
                            {d === null || d === undefined ? "—" : `${d > 0 ? "+" : ""}${fmt(d, 1)}`}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </ResourceView>
    </WidgetFrame>
  );
}

// Wrapper so the popover can read resolved curves out of the resource state.
function SettingsPopoverWrapper({
  prefs,
  setPrefs,
  state,
}: {
  prefs: YieldPrefs;
  setPrefs: (p: YieldPrefs) => void;
  state: ReturnType<typeof useResource<Schemas["YieldCurveResponse"]>>["state"];
}) {
  const curvesByKey = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, AsOfCurve>();
    return new Map((state.data.curves ?? []).map((c) => [c.key, c as AsOfCurve]));
  }, [state]);
  return <SettingsPopover prefs={prefs} setPrefs={setPrefs} curvesByKey={curvesByKey} />;
}
```

- [ ] **Step 2: Type-check the whole frontend**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (the `data.points` reference is gone; `AsOfCurve` resolves from the regenerated schema).

- [ ] **Step 3: Run lint + the full frontend test suite**

Run: `cd web && npm run test && npm run lint`
Expected: vitest PASS (yieldDelta, yieldPrefs, store); lint clean.

- [ ] **Step 4: Commit**

```bash
git add web/app/widgets/YieldWidget.tsx
git commit -m "feat(web): yield widget — overlaid curves, bp-change columns, settings popover"
```

---

## Task 11: End-to-end verification

**Files:** none (manual + suite verification)

- [ ] **Step 1: Run the full backend suite**

Run: `cd api && python -m pytest -v`
Expected: all PASS.

- [ ] **Step 2: Run the full frontend suite + typecheck + lint**

Run: `cd web && npx tsc --noEmit && npm run test && npm run lint`
Expected: all PASS / clean.

- [ ] **Step 3: Manual smoke test**

Start backend (`cd api && uvicorn app.main:app --host 127.0.0.1 --port 8000`) and frontend (`cd web && npm run dev`). In the terminal UI:
- Type `yield`. Expected: chart shows **two** lines (Today + 1W ago) with a legend showing both dates; the table shows Rate % plus six Δ columns (1d/1w/1m/3m/6m/1y) in basis points, green/red.
- Open the `⚙ curves` popover. Toggle `1m` Chart on → a third line appears. Toggle `1d` Δ off → that column disappears.
- Add an exact date (e.g. one ~2 months back). Expected: a new Δ column and (if Chart checked) a new line appear after a refetch; legend shows its resolved date.
- Reload the page. Expected: toggles + added date persist (localStorage).
- With FRED key absent in `api/.env`, type `yield`. Expected: the unauthenticated state renders (no crash).

- [ ] **Step 4: Verify the FRED rule is still honored**

Confirm `.claude/rules/fred-and-news.md` constraints hold: still using the `series/observations` endpoint with `api_key` query param; series IDs unchanged; dates normalized to epoch-ms; canonical `YieldPoint` emitted. No new series introduced.

- [ ] **Step 5: Final commit (if any stragglers)**

```bash
git status   # expect clean; if anything uncommitted, add + commit with a descriptive message
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** historical curves (Task 3), bp-change columns current−comparison (Tasks 3/6/10), relative + exact dates (Tasks 3/7), default current+1w overlay with all six Δ columns (Task 7 defaults + Task 10 render), show/hide via popover (Tasks 8/10), persistence (Task 7), Δ for every added curve vs current (Task 10 deltaCols), graceful empty/missing states (Tasks 3/4/10), type contract regeneration (Task 5). No scrubber / date-ranges (out of scope per spec).
- **Type consistency:** backend `AsOfCurve.key` values (`current`/period/iso-date) match frontend `compareKey()` outputs; `loadYield(asof[])` ↔ router `asof` Query; `computeDeltaBp` signature stable across Tasks 6 and 10; `headerExtra` prop name consistent Tasks 8 and 10.
- **Placeholder scan:** none — every code step is complete.
