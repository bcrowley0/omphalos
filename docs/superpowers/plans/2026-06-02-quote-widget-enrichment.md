# Quote Widget Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the quote widget with day stats (open/high/low/volume/VWAP), 52-week range, market cap, and a multi-period price-change ladder (`1D 1W 1M 3M YTD 1Y 5Y`).

**Architecture:** Extend the canonical `Quote` Pydantic model with optional day-stat fields and add a `PeriodChange` model; the `/quote` endpoint fetches the enriched snapshot AND ~5Y of daily candles via the same adapter, computing the ladder with a pure, unit-tested `compute_period_changes()`. A history-fetch failure sets `period_status` without dropping the quote. Frontend TS types are regenerated from OpenAPI; the widget renders the new data, with row-level graceful hiding for unsupported fields.

**Tech Stack:** FastAPI / Pydantic (Python 3.14), pytest; Next.js / React / TypeScript, vitest (node env, pure-function tests), openapi-typescript.

**Spec:** `docs/superpowers/specs/2026-06-02-quote-widget-enrichment-design.md`

---

## File Structure

**Backend (`api/`):**
- `app/models.py` — MODIFY: add day-stat fields to `Quote`; add `PeriodChange`; add `period_changes` + `period_status` to `QuoteResponse`.
- `app/quotes.py` — CREATE: pure `compute_period_changes(candles, now_ms)` + period constants.
- `app/adapters/kraken.py` — MODIFY: `parse_ticker` maps the 24h day-stat fields.
- `app/adapters/ibkr.py` — MODIFY: add verified snapshot field codes to `_FIELDS`; `parse_snapshot` maps them.
- `app/adapters/mock.py` — MODIFY: `get_quote` populates the new fields.
- `app/routers.py` — MODIFY: `/quote` fetches daily candles + computes the ladder.
- `tests/test_quotes.py` — CREATE: `compute_period_changes` unit tests.
- `tests/test_kraken.py`, `tests/test_ibkr.py`, `tests/test_routers.py` — MODIFY: assert new fields / endpoint behavior.

**Frontend (`web/`):**
- `app/lib/api/schema.ts` — REGENERATE via `npm run gen:api`.
- `app/lib/widgetSettings.ts` — MODIFY: add `showPeriods` + `showDayStats` quote prefs.
- `app/lib/quoteView.ts` — CREATE: pure helpers (`periodCells`, `dayStatRows`, `rangeRows`).
- `app/lib/loaders.ts` — MODIFY: extend `QuoteData` with `periodChanges` + `periodStatus`.
- `app/widgets/QuoteWidget.tsx` — MODIFY: render ladder, day stats, range/fundamentals, settings toggles.
- `app/lib/widgetSettings.test.ts`, `app/lib/quoteView.test.ts` — MODIFY/CREATE: pure-function tests.

---

## Task 1: Extend the Quote / QuoteResponse models

**Files:**
- Modify: `api/app/models.py:104-113` (`Quote`), `api/app/models.py:186-189` (`QuoteResponse`)
- Test: `api/tests/test_quotes.py` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_quotes.py`:

```python
from app.models import PeriodChange, Quote, QuoteResponse, SourceStatus


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_quotes.py -v`
Expected: FAIL — `ImportError: cannot import name 'PeriodChange'` (and attribute errors for the new fields).

- [ ] **Step 3: Add the new fields and model**

In `api/app/models.py`, replace the `Quote` class body (lines 104-113) with:

```python
class Quote(CamelModel):
    symbol: str
    last: float | None = None
    bid: float | None = None
    ask: float | None = None
    change: float | None = None
    change_pct: float | None = None
    ts: int | None = None  # UTC epoch ms
    stale: bool = False
    source: str
    # Day stats (each adapter fills what it supports; None = unsupported).
    day_open: float | None = None
    day_high: float | None = None
    day_low: float | None = None
    volume: float | None = None
    vwap: float | None = None
    # Range / fundamentals (IBKR equities only; None for crypto).
    week52_high: float | None = None
    week52_low: float | None = None
    market_cap: float | None = None
```

Immediately after the `Quote` class, add:

```python
class PeriodChange(CamelModel):
    period: str  # "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y"
    change: float | None = None
    change_pct: float | None = None
    ref_close: float | None = None  # the close we compared against
```

In `QuoteResponse` (lines 186-189), add the two fields:

```python
class QuoteResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    quote: Quote | None = None
    period_changes: list[PeriodChange] = []
    period_status: SourceStatus = SourceStatus.OK
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_quotes.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add api/app/models.py api/tests/test_quotes.py
git commit -m "feat(api): extend Quote with day stats + PeriodChange model"
```

---

## Task 2: Pure period-ladder computation

**Files:**
- Create: `api/app/quotes.py`
- Test: `api/tests/test_quotes.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_quotes.py`:

```python
from datetime import datetime, timezone

from app.models import Candle
from app.quotes import PERIOD_ORDER, compute_period_changes

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_quotes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.quotes'`.

- [ ] **Step 3: Implement the pure function**

Create `api/app/quotes.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_quotes.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/quotes.py api/tests/test_quotes.py
git commit -m "feat(api): pure compute_period_changes for the change ladder"
```

---

## Task 3: Kraken — map 24h day stats in parse_ticker

**Files:**
- Modify: `api/app/adapters/kraken.py:250-271` (`parse_ticker`)
- Test: `api/tests/test_kraken.py` (append)

Kraken Ticker payload arrays: `o`=today open, `h`=[today, 24h] high, `l`=[today, 24h] low, `v`=[today, 24h] volume, `p`=[today, 24h] VWAP. Use the **24h** value (index `[1]`).

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_kraken.py`:

```python
from app.adapters.kraken import parse_ticker


def test_parse_ticker_populates_day_stats():
    payload = {
        "error": [],
        "result": {
            "XXBTZUSD": {
                "a": ["101.0", "1", "1.0"],
                "b": ["100.0", "1", "1.0"],
                "c": ["100.5", "0.1"],
                "v": ["10.0", "250.0"],
                "p": ["99.0", "98.5"],
                "t": [100, 2000],
                "l": ["95.0", "90.0"],
                "h": ["105.0", "110.0"],
                "o": "97.0",
            }
        },
    }
    q = parse_ticker(payload, "BTC/USD")
    assert q.day_open == 97.0
    assert q.day_high == 110.0   # 24h high (index 1)
    assert q.day_low == 90.0     # 24h low (index 1)
    assert q.volume == 250.0     # 24h volume (index 1)
    assert q.vwap == 98.5        # 24h vwap (index 1)
    # crypto has no equity fundamentals
    assert q.week52_high is None
    assert q.market_cap is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_kraken.py::test_parse_ticker_populates_day_stats -v`
Expected: FAIL — `assert None == 97.0`.

- [ ] **Step 3: Map the fields**

In `api/app/adapters/kraken.py`, in `parse_ticker`, after `open_ = float(raw_open)` and before the `return Quote(...)`, add helpers and extend the return. Replace the `return Quote(...)` block (lines 261-271) with:

```python
    def _arr24(key: str) -> float | None:
        val = t.get(key)
        if isinstance(val, list) and len(val) > 1:
            return float(val[1])
        return None

    return Quote(
        symbol=symbol,
        last=last,
        bid=bid,
        ask=ask,
        change=change,
        change_pct=change_pct,
        ts=None,
        stale=False,
        source="kraken",
        day_open=open_,
        day_high=_arr24("h"),
        day_low=_arr24("l"),
        volume=_arr24("v"),
        vwap=_arr24("p"),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_kraken.py -v`
Expected: PASS (existing Kraken tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/kraken.py api/tests/test_kraken.py
git commit -m "feat(api): kraken parse_ticker maps 24h day stats"
```

---

## Task 4: IBKR — verify field codes, then map them

**Files:**
- Modify: `api/app/adapters/ibkr.py:28-38` (`_FIELDS`), `api/app/adapters/ibkr.py:87-105` (`parse_snapshot`)
- Test: `api/tests/test_ibkr.py` (append)

- [ ] **Step 1: Verify the field codes against official docs (GATING — do not skip)**

Per `.claude/rules/ibkr.md`: do NOT ship a guessed field-code mapping. Verify each numeric code below against IBKR's official Client Portal Web API "marketdata snapshot" field reference (use the context7 MCP docs tool for `interactivebrokers` / the Client Portal API, or the official web reference):

| Field        | Candidate code |
| ------------ | -------------- |
| day high     | 70             |
| day low      | 71             |
| 52-week high | 7293           |
| 52-week low  | 7294           |
| market cap   | 7289           |

Record the verified codes. If a code differs, use the verified value in Steps 3-4. If a field genuinely has no documented snapshot code, leave it unmapped (do not guess) and note it in the commit message. The test in Step 3 must use the **verified** codes.

- [ ] **Step 2: Write the failing test (using verified codes)**

Append to `api/tests/test_ibkr.py` (shown with the candidate codes — substitute verified values if different):

```python
def test_parse_snapshot_maps_day_stats_and_fundamentals():
    from app.adapters.ibkr import parse_snapshot

    row = {
        "31": "150.0",   # last
        "84": "149.9",   # bid
        "86": "150.1",   # ask
        "82": "1.5",     # change
        "83": "1.0",     # change pct
        "87": "1000000", # volume
        "7295": "148.0", # open
        "70": "151.0",   # day high
        "71": "147.5",   # day low
        "7293": "199.0", # 52w high
        "7294": "120.0", # 52w low
        "7289": "2500000000",  # market cap
    }
    q = parse_snapshot(row, "AAPL")
    assert q.day_open == 148.0
    assert q.day_high == 151.0
    assert q.day_low == 147.5
    assert q.volume == 1000000.0
    assert q.week52_high == 199.0
    assert q.week52_low == 120.0
    assert q.market_cap == 2500000000.0


def test_parse_snapshot_missing_fundamentals_are_none():
    from app.adapters.ibkr import parse_snapshot

    q = parse_snapshot({"31": "150.0"}, "AAPL")
    assert q.market_cap is None
    assert q.day_high is None
    assert q.vwap is None  # IBKR snapshot has no VWAP field
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_ibkr.py -k snapshot -v`
Expected: FAIL — new asserts fail (`assert None == 148.0`).

- [ ] **Step 4: Add codes to `_FIELDS` and map in `parse_snapshot`**

In `api/app/adapters/ibkr.py`, extend `_FIELDS` (lines 29-38) with the verified codes:

```python
_FIELDS: dict[str, str] = {
    "31": "last",
    "84": "bid",
    "86": "ask",
    "82": "change",
    "83": "change_pct",
    "87": "volume",
    "7295": "open",
    "7296": "close",
    "70": "day_high",
    "71": "day_low",
    "7293": "week52_high",
    "7294": "week52_low",
    "7289": "market_cap",
}
```

Replace the `return Quote(...)` in `parse_snapshot` (lines 95-105) with:

```python
    return Quote(
        symbol=symbol,
        last=_num(row.get("31")),
        bid=_num(row.get("84")),
        ask=_num(row.get("86")),
        change=_num(row.get("82")),
        change_pct=_num(row.get("83")),
        ts=int(row["_updated"]) if isinstance(row.get("_updated"), (int, float)) else None,
        stale=stale,
        source="ibkr",
        day_open=_num(row.get("7295")),
        day_high=_num(row.get("70")),
        day_low=_num(row.get("71")),
        volume=_num(row.get("87")),
        week52_high=_num(row.get("7293")),
        week52_low=_num(row.get("7294")),
        market_cap=_num(row.get("7289")),
    )
```

(VWAP is intentionally omitted — IBKR's snapshot has no VWAP field; it stays `None`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_ibkr.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/ibkr.py api/tests/test_ibkr.py
git commit -m "feat(api): ibkr snapshot maps day stats + 52wk range + market cap (codes verified)"
```

---

## Task 5: Mock adapter — populate new fields

**Files:**
- Modify: `api/app/adapters/mock.py:70-86` (`get_quote`)
- Test: `api/tests/test_quotes.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_quotes.py`:

```python
import asyncio

from app.adapters.mock import MockAdapter


def test_mock_quote_populates_day_stats():
    q = asyncio.run(MockAdapter().get_quote("AAPL"))
    assert q.day_open is not None
    assert q.day_high is not None
    assert q.day_low is not None
    assert q.volume is not None
    assert q.vwap is not None
    assert q.week52_high is not None
    assert q.week52_low is not None
    assert q.market_cap is not None
    assert q.day_high >= q.day_low
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_quotes.py::test_mock_quote_populates_day_stats -v`
Expected: FAIL — `assert None is not None`.

- [ ] **Step 3: Populate the fields**

In `api/app/adapters/mock.py`, replace the `get_quote` body (lines 70-86) with:

```python
    async def get_quote(self, symbol: str) -> Quote:
        candles = await self.get_candles(symbol)
        prev, latest = candles[-2].c, candles[-1].c
        change = round(latest - prev, 2)
        change_pct = round((change / prev) * 100, 2) if prev else 0.0
        spread = round(latest * 0.0005, 2)
        recent = candles[-30:] if len(candles) >= 30 else candles
        highs = [c.h for c in recent]
        lows = [c.l for c in recent]
        vol = sum(c.v for c in recent) / len(recent)
        return Quote(
            symbol=symbol,
            last=latest,
            bid=round(latest - spread, 2),
            ask=round(latest + spread, 2),
            change=change,
            change_pct=change_pct,
            ts=_now_ms(),
            stale=False,
            source=self.name,
            day_open=candles[-1].o,
            day_high=candles[-1].h,
            day_low=candles[-1].l,
            volume=round(candles[-1].v, 2),
            vwap=round((candles[-1].h + candles[-1].l + latest) / 3, 2),
            week52_high=round(max(highs), 2),
            week52_low=round(min(lows), 2),
            market_cap=round(latest * 1_000_000_000, 2),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_quotes.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/adapters/mock.py api/tests/test_quotes.py
git commit -m "feat(api): mock adapter populates enriched quote fields"
```

---

## Task 6: Wire the /quote endpoint to compute the ladder

**Files:**
- Modify: `api/app/routers.py:123-137` (`/quote`) and its imports
- Test: `api/tests/test_routers.py` (append)

- [ ] **Step 1: Write the failing test**

First check how existing router tests build the client (look at the top of `api/tests/test_routers.py` for the `TestClient`/`app` fixture and any mock-adapter wiring; reuse that exact pattern). Append a test that drives `/quote` against the mock source. The mock symbol `AAPL` resolves to the mock adapter in dev; if the test module already has a helper to force the mock source, use it. Append:

```python
def test_quote_endpoint_returns_period_ladder(client):
    # `client` = the TestClient fixture already used by other tests in this file.
    resp = client.get("/quote", params={"symbol": "AAPL"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["quote"]["dayHigh"] is not None
    periods = [p["period"] for p in body["periodChanges"]]
    assert periods == ["1D", "1W", "1M", "3M", "YTD", "1Y", "5Y"]
    assert body["periodStatus"] == "ok"
```

> If `test_routers.py` does not expose a `client` fixture, copy the client-construction lines from the top of that file into this test (do not invent a new fixture name).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && python -m pytest tests/test_routers.py::test_quote_endpoint_returns_period_ladder -v`
Expected: FAIL — `KeyError: 'periodChanges'`.

- [ ] **Step 3: Wire the endpoint**

In `api/app/routers.py`, ensure these imports exist at the top (add what's missing): `import time`; from models import `Interval, Span, PeriodChange`; `from .quotes import compute_period_changes`.

Replace the `quote` handler (lines 123-137) with:

```python
@router.get("/quote", response_model=QuoteResponse, tags=["market"])
async def quote(symbol: str = Query(...)) -> QuoteResponse:
    r = resolve(symbol)
    adapter = _adapter(r.source)
    if adapter is None:
        return QuoteResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{r.source} integration not available.",
        )
    try:
        q: Quote = await adapter.get_quote(r.symbol)
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return QuoteResponse(status=status, message=msg)

    # Period ladder: a separate source call. Its failure is surfaced via
    # period_status and must NEVER drop the live quote (CLAUDE.md rule 6).
    period_changes: list[PeriodChange] = []
    period_status = SourceStatus.OK
    try:
        candles = await adapter.get_candles(r.symbol, interval=Interval.D1, span=Span.Y5)
        period_changes = compute_period_changes(candles, int(time.time() * 1000))
        if not period_changes:
            period_status = SourceStatus.EMPTY
    except Exception as exc:  # noqa: BLE001
        period_status, _ = _status_from_exc(exc)

    return QuoteResponse(
        status=SourceStatus.OK,
        quote=q,
        period_changes=period_changes,
        period_status=period_status,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && python -m pytest tests/test_routers.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd api && python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add api/app/routers.py api/tests/test_routers.py
git commit -m "feat(api): /quote returns multi-period change ladder"
```

---

## Task 7: Regenerate frontend types from OpenAPI

**Files:**
- Regenerate: `web/app/lib/api/schema.ts`

- [ ] **Step 1: Start the backend**

Run (from repo root): `cd api && uvicorn app.main:app --host 127.0.0.1 --port 8000 &`
Wait ~2s, then verify: `curl -s http://127.0.0.1:8000/openapi.json | head -c 80`
Expected: JSON beginning with `{"openapi":`.

> If the backend is already running for dev, skip the launch and just confirm the curl works.

- [ ] **Step 2: Regenerate types**

Run: `cd web && npm run gen:api`
Expected: `app/lib/api/schema.ts` rewritten with no error.

- [ ] **Step 3: Verify the new fields landed**

Run: `cd web && grep -n "dayHigh\|periodChanges\|PeriodChange\|marketCap" app/lib/api/schema.ts`
Expected: matches for `dayHigh`, `marketCap`, `periodChanges`, and a `PeriodChange` schema.

- [ ] **Step 4: Stop the backend if you started it**

Run: `kill %1` (only if you launched it in Step 1).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate API types for enriched quote"
```

---

## Task 8: Add quote display prefs (showPeriods, showDayStats)

**Files:**
- Modify: `web/app/lib/widgetSettings.ts:14-23`
- Test: `web/app/lib/widgetSettings.test.ts`

- [ ] **Step 1: Write the failing test**

In `web/app/lib/widgetSettings.test.ts`, add a test (place near the other coercer tests):

```ts
import { coerceQuotePrefs, DEFAULT_QUOTE_PREFS } from "./widgetSettings";

describe("quote prefs", () => {
  it("defaults the new toggles to true", () => {
    expect(DEFAULT_QUOTE_PREFS.showPeriods).toBe(true);
    expect(DEFAULT_QUOTE_PREFS.showDayStats).toBe(true);
  });
  it("coerces partial / bad input to defaults", () => {
    expect(coerceQuotePrefs({ showPeriods: false }).showPeriods).toBe(false);
    expect(coerceQuotePrefs({ showPeriods: "nope" }).showPeriods).toBe(true);
    expect(coerceQuotePrefs({}).showDayStats).toBe(true);
  });
});
```

> If `coerceQuotePrefs`/`DEFAULT_QUOTE_PREFS` are already imported at the top of the file, do not duplicate the import — just add the `describe` block.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/widgetSettings.test.ts`
Expected: FAIL — `expected undefined to be true` for `showPeriods`.

- [ ] **Step 3: Extend the prefs**

In `web/app/lib/widgetSettings.ts`, replace the Quote block (lines 14-23) with:

```ts
// ---- Quote ----------------------------------------------------------------
export const QUOTE_PREFS_KEY = "omphalos.quote.prefs.v1";
export type QuotePrefs = {
  showSource: boolean;
  showStale: boolean;
  showPeriods: boolean;
  showDayStats: boolean;
};
export const DEFAULT_QUOTE_PREFS: QuotePrefs = {
  showSource: true,
  showStale: true,
  showPeriods: true,
  showDayStats: true,
};
export function coerceQuotePrefs(x: unknown): QuotePrefs {
  const p = asObject(x);
  return {
    showSource: bool(p.showSource, true),
    showStale: bool(p.showStale, true),
    showPeriods: bool(p.showPeriods, true),
    showDayStats: bool(p.showDayStats, true),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/widgetSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/widgetSettings.ts web/app/lib/widgetSettings.test.ts
git commit -m "feat(web): quote prefs add showPeriods + showDayStats toggles"
```

---

## Task 9: Pure quote view helpers

**Files:**
- Create: `web/app/lib/quoteView.ts`
- Test: `web/app/lib/quoteView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/quoteView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PERIOD_ORDER, periodCells, dayStatRows, rangeRows } from "./quoteView";
import type { Schemas } from "./api/client";

type Quote = Schemas["Quote"];

function q(extra: Partial<Quote>): Quote {
  return { symbol: "X", source: "mock", stale: false, ...extra } as Quote;
}

describe("periodCells", () => {
  it("returns all periods in order, filling missing with null", () => {
    const cells = periodCells([{ period: "1M", changePct: 2.5 }] as Schemas["PeriodChange"][]);
    expect(cells.map((c) => c.period)).toEqual([...PERIOD_ORDER]);
    expect(cells.find((c) => c.period === "1M")!.pct).toBe(2.5);
    expect(cells.find((c) => c.period === "1Y")!.pct).toBeNull();
  });
  it("treats undefined input as all-null", () => {
    expect(periodCells(undefined).every((c) => c.pct === null)).toBe(true);
  });
});

describe("dayStatRows", () => {
  it("hides rows whose value is null/undefined", () => {
    const rows = dayStatRows(q({ dayOpen: 10, dayHigh: 12, volume: null, vwap: 11 }));
    expect(rows.map((r) => r.label)).toEqual(["open", "high", "vwap"]);
  });
});

describe("rangeRows", () => {
  it("shows only present fundamentals (market cap only when set)", () => {
    expect(rangeRows(q({ week52High: 100 })).map((r) => r.label)).toEqual(["52w high"]);
    expect(rangeRows(q({ marketCap: 5 })).map((r) => r.label)).toEqual(["mkt cap"]);
    expect(rangeRows(q({})).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/quoteView.test.ts`
Expected: FAIL — cannot resolve `./quoteView`.

- [ ] **Step 3: Implement the helpers**

Create `web/app/lib/quoteView.ts`:

```ts
import type { Schemas } from "./api/client";

// Display order of the multi-period change ladder (mirrors the backend).
export const PERIOD_ORDER = ["1D", "1W", "1M", "3M", "YTD", "1Y", "5Y"] as const;

export type PeriodCell = { period: string; pct: number | null };

// Project the backend ladder onto the fixed display order; missing/None -> null.
export function periodCells(changes: Schemas["PeriodChange"][] | undefined): PeriodCell[] {
  const byPeriod = new Map((changes ?? []).map((c) => [c.period, c.changePct ?? null]));
  return PERIOD_ORDER.map((period) => ({
    period,
    pct: byPeriod.has(period) ? byPeriod.get(period)! : null,
  }));
}

export type StatRow = { label: string; value: number };

function present(rows: { label: string; value: number | null | undefined }[]): StatRow[] {
  return rows.filter((r): r is StatRow => r.value !== null && r.value !== undefined);
}

// Day stats — each row hidden when its value is absent (graceful missing fields).
export function dayStatRows(q: Schemas["Quote"]): StatRow[] {
  return present([
    { label: "open", value: q.dayOpen },
    { label: "high", value: q.dayHigh },
    { label: "low", value: q.dayLow },
    { label: "volume", value: q.volume },
    { label: "vwap", value: q.vwap },
  ]);
}

// Range / fundamentals — shown only when present (crypto omits these).
export function rangeRows(q: Schemas["Quote"]): StatRow[] {
  return present([
    { label: "52w high", value: q.week52High },
    { label: "52w low", value: q.week52Low },
    { label: "mkt cap", value: q.marketCap },
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/quoteView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/quoteView.ts web/app/lib/quoteView.test.ts
git commit -m "feat(web): pure quote view helpers (ladder + stat rows)"
```

---

## Task 10: Render the enriched widget

**Files:**
- Modify: `web/app/lib/loaders.ts:106-115` (`QuoteData` + `loadQuoteData`)
- Modify: `web/app/widgets/QuoteWidget.tsx` (full rewrite of the body)

- [ ] **Step 1: Extend QuoteData (no behavior change to watchlist)**

In `web/app/lib/loaders.ts`, replace the `QuoteData` type and `loadQuoteData` (lines 106-115) with:

```ts
export type QuoteData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  quote: Schemas["Quote"] | null | undefined;
  periodChanges: Schemas["PeriodChange"][];
  periodStatus: Schemas["SourceStatus"];
};

export async function loadQuoteData(symbol: string): Promise<QuoteData> {
  const r = await loadQuote(symbol);
  return {
    status: r.status,
    message: r.message,
    quote: r.quote,
    periodChanges: r.periodChanges ?? [],
    periodStatus: r.periodStatus ?? "ok",
  };
}
```

(`loadWatchlist` reads only `.quote`, so it is unaffected.)

- [ ] **Step 2: Rewrite the widget**

Replace the entire contents of `web/app/widgets/QuoteWidget.tsx` with:

```tsx
"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, StatusNotice, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { ToggleRow } from "../components/WidgetSettingsMenu";
import { loadQuoteData } from "../lib/loaders";
import type { QuoteData } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { coerceQuotePrefs, DEFAULT_QUOTE_PREFS, QUOTE_PREFS_KEY } from "../lib/widgetSettings";
import { periodCells, dayStatRows, rangeRows } from "../lib/quoteView";
import type { Quote, SourceStatus } from "../lib/api/client";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PeriodLadder({
  changes,
  status,
}: {
  changes: QuoteData["periodChanges"];
  status: SourceStatus;
}) {
  const cells = periodCells(changes);
  return (
    <div style={{ margin: "0.5rem 0 0.85rem" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {cells.map((c) => (
          <div key={c.period} style={{ textAlign: "center", minWidth: "3rem" }}>
            <div style={{ color: "var(--muted)", fontSize: "0.7rem" }}>{c.period}</div>
            <div style={{ color: signColor(c.pct) }}>
              {c.pct == null ? "—" : `${c.pct > 0 ? "+" : ""}${fmt(c.pct)}%`}
            </div>
          </div>
        ))}
      </div>
      {status !== "ok" && status !== "empty" && (
        <div style={{ marginTop: "0.5rem" }}>
          <StatusNotice status={status} message="Price history unavailable." />
        </div>
      )}
    </div>
  );
}

function QuoteBody({
  q,
  data,
  showStale,
  showPeriods,
  showDayStats,
}: {
  q: Quote;
  data: QuoteData;
  showStale: boolean;
  showPeriods: boolean;
  showDayStats: boolean;
}) {
  const stats = dayStatRows(q);
  const fundamentals = rangeRows(q);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "2rem" }}>{fmt(q.last)}</span>
        <span style={{ color: signColor(q.change) }}>
          {q.change != null && q.change > 0 ? "+" : ""}
          {fmt(q.change)} ({fmt(q.changePct)}%)
        </span>
        {showStale && q.stale && <span style={{ color: "#d9a441", fontSize: "0.8rem" }}>stale</span>}
      </div>

      {showPeriods && <PeriodLadder changes={data.periodChanges} status={data.periodStatus} />}

      {showDayStats &&
        stats.map((r) => (
          <Row key={r.label} label={r.label} value={fmt(r.value, r.label === "volume" ? 0 : 2)} />
        ))}

      {fundamentals.map((r) => (
        <Row key={r.label} label={r.label} value={fmt(r.value, r.label === "mkt cap" ? 0 : 2)} />
      ))}

      <Row label="bid" value={fmt(q.bid)} />
      <Row label="ask" value={fmt(q.ask)} />
    </div>
  );
}

export default function QuoteWidget({ symbol, tabId }: { symbol: string; tabId: string }) {
  const [prefs, setPrefs] = useWidgetPrefs(QUOTE_PREFS_KEY, DEFAULT_QUOTE_PREFS, coerceQuotePrefs);
  const load = useCallback(() => loadQuoteData(symbol), [symbol]);
  const { on, setOn, pausedReason, onAutoDisabled } = useAutoRefreshToggle(tabId);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("quote"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });

  const source = prefs.showSource && state.kind === "ok" ? state.data.quote?.source : undefined;

  const settings = (
    <WidgetSettingsMenu title="quote settings">
      <ToggleRow label="Show source" checked={prefs.showSource} onChange={() => setPrefs({ ...prefs, showSource: !prefs.showSource })} />
      <ToggleRow label="Show stale badge" checked={prefs.showStale} onChange={() => setPrefs({ ...prefs, showStale: !prefs.showStale })} />
      <ToggleRow label="Show period changes" checked={prefs.showPeriods} onChange={() => setPrefs({ ...prefs, showPeriods: !prefs.showPeriods })} />
      <ToggleRow label="Show day stats" checked={prefs.showDayStats} onChange={() => setPrefs({ ...prefs, showDayStats: !prefs.showDayStats })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title={`Quote · ${symbol}`}
      source={source}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing, paused: pausedReason }}
    >
      <ResourceView state={state}>
        {(data) =>
          data.quote ? (
            <QuoteBody
              q={data.quote}
              data={data}
              showStale={prefs.showStale}
              showPeriods={prefs.showPeriods}
              showDayStats={prefs.showDayStats}
            />
          ) : (
            <StatusNotice status="empty" message="No quote." />
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `cd web && npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors, no lint errors, build succeeds.

> If `tsc` reports that `ResourceView`'s data type lacks `periodChanges`/`periodStatus`, confirm Task 7 regenerated `schema.ts` and Task 10 Step 1 extended `QuoteData` — the `useResource(load)` generic infers `QuoteData` from `loadQuoteData`.

- [ ] **Step 4: Commit**

```bash
git add web/app/lib/loaders.ts web/app/widgets/QuoteWidget.tsx
git commit -m "feat(web): render enriched quote widget (ladder, day stats, range)"
```

---

## Task 11: Full verification

- [ ] **Step 1: Backend suite**

Run: `cd api && python -m pytest -q`
Expected: all pass.

- [ ] **Step 2: Frontend suite + build**

Run: `cd web && npx vitest run && npm run build`
Expected: all tests pass (≥ 79 prior + new), build succeeds.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Start backend + frontend (`./dev.sh` if present, else run `uvicorn` and `npm run dev`), open the app, type `quote AAPL` (mock/IBKR) and `crypto BTC/USD` (Kraken). Verify:
- Period ladder shows 7 periods; crypto shows no market cap / 52w rows; equity shows them.
- Toggling "Show period changes" / "Show day stats" hides the respective blocks.
- Turning on auto-refresh updates without errors.

- [ ] **Step 4: Final commit (if any smoke fixes)**

```bash
git add -A
git commit -m "chore: quote widget enrichment verification fixes"
```

---

## Notes / Constraints honored

- Read-only; no order entry; no websockets. ✓
- Adapter pattern: each adapter fills the subset it supports; missing fields are `None` and rendered as hidden rows / `—`. ✓
- Backend Pydantic models are the single source of truth; frontend types regenerated from OpenAPI (no hand-written duplicates). ✓
- Explicit UI states: the new `period_status` surfaces a history-fetch failure without dropping the live quote. ✓
- IBKR field codes verified against official docs before use (Task 4 Step 1). ✓
- Bounded auto-refresh unchanged: the widget re-fetches the one `/quote` resource; the backend TTL cache absorbs repeated daily-history fetches. ✓
```
