# Chart Span + Interval Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two button rows to the chart widget — chart span (1D/5D/1M/3M/1Y/5Y) and candle interval (1m/5m/15m/1h/4h/1d/1w) — wired end-to-end through Kraken (crypto) and IBKR (equities, newly implemented).

**Architecture:** The backend Pydantic `Interval`/`Span` enums are the single source of truth (TS types regenerate from OpenAPI). The `/chart` and `/crypto` endpoints accept `interval` + `span` query params, pass them to adapters, and echo the resolved values back. Each adapter maps the canonical pair to its native params (Kraken: minutes + `since`; IBKR: `bar` + `period`). On the frontend, a pure `resolveRange(span, interval)` function enforces valid span/interval pairs (span auto-snaps interval, invalid intervals disabled); `ChartWidget` holds the state and refetches on change.

**Tech Stack:** FastAPI + Pydantic (Python 3.14), pytest + httpx.MockTransport; Next.js + React + TypeScript, openapi-fetch, vitest; TradingView Lightweight Charts v5.

**Reference docs to consult during implementation:**
- IBKR history endpoint: `.claude/rules/ibkr.md`; example request `GET /iserver/marketdata/history?conid=...&period=2d&bar=1h`. `bar` tokens: `1min,5min,15min,1h,4h,1d,1w`. `period` tokens: `1d,5d,1m,3m,1y,5y`. Response `data[]` rows carry `t` (epoch **ms**, no ÷1000), `o,h,l,c,v`.
- Kraken OHLC: `.claude/rules/kraken.md`; `since` param is epoch **seconds**; returns ≤720 points.
- Type contract: `CLAUDE.md` — never hand-write TS that duplicates Pydantic; regenerate from OpenAPI.

---

## File Structure

**Backend (modify):**
- `api/app/models.py` — add `Interval`, `Span` enums; `INTERVAL_MS`, `SPAN_MS` maps; echo fields on `CandlesResponse`/`CryptoResponse`.
- `api/app/adapters/base.py` — widen `get_candles` signature.
- `api/app/adapters/mock.py` — honor interval/span (count + step).
- `api/app/adapters/kraken.py` — `kraken_ohlc_params` helper + `since` in `get_candles`.
- `api/app/adapters/ibkr.py` — `ibkr_bar`/`ibkr_period`/`parse_history` + implement `get_candles`.
- `api/app/routers.py` — enum query params + echo on `/chart` and `/crypto`.

**Backend (create):**
- `api/tests/test_chart_controls.py` — model + mock + kraken + ibkr pure/transport tests.
- `api/tests/test_routers.py` — TestClient 422 + echo.

**Frontend (create):**
- `web/app/lib/chart/range.ts` — `resolveRange`, `validIntervals`, `SPANS`, `INTERVALS`, defaults.
- `web/app/lib/chart/range.test.ts` — pure-function tests.
- `web/app/components/ChartControls.tsx` — two presentational button rows.

**Frontend (modify):**
- `web/app/lib/loaders.ts` — thread `interval`/`span` through `loadChart`/`loadCrypto`/`loadChartData`.
- `web/app/widgets/ChartWidget.tsx` — span/interval state + render `ChartControls`.
- `web/app/lib/api/schema.ts` — regenerated (do not hand-edit).

---

## Task 1: Backend enums, maps, and response echo fields

**Files:**
- Modify: `api/app/models.py`
- Test: `api/tests/test_chart_controls.py` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_chart_controls.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -v`
Expected: FAIL with `ImportError: cannot import name 'Interval'` (or `INTERVAL_MS`).

- [ ] **Step 3: Write minimal implementation**

In `api/app/models.py`, the top already has `from enum import Enum`. Add these definitions immediately after the `SourceStatus` enum (around line 40):

```python
class Interval(str, Enum):
    """Candle size (bar granularity)."""

    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"
    W1 = "1w"


class Span(str, Enum):
    """Chart lookback window."""

    D1 = "1D"
    D5 = "5D"
    M1 = "1M"
    M3 = "3M"
    Y1 = "1Y"
    Y5 = "5Y"


_MIN_MS = 60_000
_DAY_MS = 86_400_000

# Bar length in epoch-ms, per interval.
INTERVAL_MS: dict[Interval, int] = {
    Interval.M1: 1 * _MIN_MS,
    Interval.M5: 5 * _MIN_MS,
    Interval.M15: 15 * _MIN_MS,
    Interval.H1: 60 * _MIN_MS,
    Interval.H4: 240 * _MIN_MS,
    Interval.D1: 1440 * _MIN_MS,
    Interval.W1: 10080 * _MIN_MS,
}

# Lookback window in epoch-ms, per span (calendar approximations).
SPAN_MS: dict[Span, int] = {
    Span.D1: 1 * _DAY_MS,
    Span.D5: 5 * _DAY_MS,
    Span.M1: 30 * _DAY_MS,
    Span.M3: 90 * _DAY_MS,
    Span.Y1: 365 * _DAY_MS,
    Span.Y5: 5 * 365 * _DAY_MS,
}
```

Then add the echo fields to the existing response models. Find `CandlesResponse` (around line 102) and add the two fields:

```python
class CandlesResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    symbol: str
    source: str
    candles: list[Candle] = []
    interval: Interval = Interval.H1
    span: Span = Span.M1
```

Find `CryptoResponse` (around line 116) and add the two fields:

```python
class CryptoResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    pair: str
    source: str
    quote: Quote | None = None
    candles: list[Candle] = []
    interval: Interval = Interval.H1
    span: Span = Span.M1
```

(Keep the existing field names/order otherwise; only add `interval` and `span`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add api/app/models.py api/tests/test_chart_controls.py
git commit -m "feat(api): Interval/Span enums + ms maps + response echo fields"
```

---

## Task 2: Base adapter signature + mock adapter honors span/interval

**Files:**
- Modify: `api/app/adapters/base.py:42-43`
- Modify: `api/app/adapters/mock.py`
- Test: `api/tests/test_chart_controls.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_chart_controls.py`:

```python
import pytest

from app.adapters.mock import MockAdapter


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
```

(The existing tests in the file use `asyncio_mode = auto` from `pytest.ini`, so `@pytest.mark.asyncio` is optional but harmless — match whichever style the file already uses; `auto` mode means plain `async def test_*` also works.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -v`
Expected: FAIL — `get_candles()` got an unexpected keyword argument `span`.

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/base.py`, update the import (line 13) and `get_candles` signature (lines 42-43):

```python
from ..models import Balance, Candle, Interval, NewsItem, Position, Quote, Span, YieldPoint
```

```python
    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        raise NotSupported(f"{self.name} does not support candles")
```

In `api/app/adapters/mock.py`, update the import (line 14):

```python
from ..models import (
    Balance,
    Candle,
    INTERVAL_MS,
    Interval,
    NewsItem,
    Position,
    Quote,
    SPAN_MS,
    Span,
    YieldPoint,
)
```

Replace `get_candles` (lines 32-52) with:

```python
    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        step = INTERVAL_MS[interval]
        count = min(max(SPAN_MS[span] // step, 2), 720)
        seed = _seed(symbol)
        base = 50 + (seed % 450)  # base price 50..500
        now = _now_ms()
        candles: list[Candle] = []
        price = float(base)
        for i in range(count):
            t = now - (count - 1 - i) * step
            # deterministic pseudo-random walk
            drift = math.sin((i + seed) / 9.0) * (base * 0.02)
            wobble = math.cos((i * 1.7 + seed) / 5.0) * (base * 0.015)
            o = price
            c = max(1.0, price + drift)
            hi = max(o, c) + abs(wobble)
            lo = min(o, c) - abs(wobble)
            v = 1_000_000 + (seed * 7 + i * 131) % 4_000_000
            candles.append(
                Candle(t=t, o=round(o, 2), h=round(hi, 2), l=round(lo, 2), c=round(c, 2), v=float(v))
            )
            price = c
        return candles
```

Replace the first line of `get_quote` (line 56) — it currently passes the removed `count=2` kwarg:

```python
    async def get_quote(self, symbol: str) -> Quote:
        candles = await self.get_candles(symbol)
        prev, latest = candles[-2].c, candles[-1].c
```

(The default `span=1M`, `interval=1d` yields 30 candles, so `candles[-2]` is safe.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Run the full mock-related suite to catch regressions**

Run: `cd api && ./.venv/bin/pytest -q`
Expected: all existing tests still PASS (the mock signature change is backward-compatible because callers either pass nothing or keyword args defined above).

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/base.py api/app/adapters/mock.py api/tests/test_chart_controls.py
git commit -m "feat(api): widen get_candles to (interval, span); mock honors both"
```

---

## Task 3: Kraken adapter — span → since

**Files:**
- Modify: `api/app/adapters/kraken.py`
- Test: `api/tests/test_chart_controls.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_chart_controls.py`:

```python
from app.adapters.kraken import kraken_ohlc_params


def test_kraken_ohlc_params_minutes_and_bar_aligned_since():
    now_ms = 1_700_000_000_000
    minutes, since = kraken_ohlc_params(Interval.H1, Span.M1, now_ms)
    assert minutes == 60
    raw = (now_ms - SPAN_MS[Span.M1]) // 1000
    bar_s = 60 * 60
    assert since == raw - (raw % bar_s)  # aligned to the bar boundary


def test_kraken_ohlc_params_one_minute_bar():
    now_ms = 1_700_000_000_000
    minutes, since = kraken_ohlc_params(Interval.M1, Span.D1, now_ms)
    assert minutes == 1
    raw = (now_ms - SPAN_MS[Span.D1]) // 1000
    assert since == raw - (raw % 60)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py::test_kraken_ohlc_params_minutes_and_bar_aligned_since -v`
Expected: FAIL with `ImportError: cannot import name 'kraken_ohlc_params'`.

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/kraken.py`, add `import time` near the top imports (after the existing stdlib imports), and add the `Interval`/`Span`/`INTERVAL_MS`/`SPAN_MS` imports to the existing `from ..models import ...` line (it currently imports `Candle, Quote, Balance` — add the four new names).

Add this pure helper near `krakenize_pair` (around line 111):

```python
def kraken_ohlc_params(interval: Interval, span: Span, now_ms: int) -> tuple[int, int]:
    """Map canonical (interval, span) to Kraken OHLC params.

    Returns (interval_minutes, since_seconds). `since` is epoch SECONDS (Kraken's
    unit) aligned down to the bar boundary so the cache key stays stable within a
    bar (avoids a fresh fetch every call). Pure/testable.
    """
    minutes = INTERVAL_MS[interval] // 60_000
    since_s = (now_ms - SPAN_MS[span]) // 1000
    bar_s = minutes * 60
    since_s -= since_s % bar_s
    return minutes, since_s
```

Replace `get_candles` (lines 190-200) with:

```python
    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        kp = krakenize_pair(symbol)
        minutes, since = kraken_ohlc_params(interval, span, int(time.time() * 1000))

        async def fetch() -> dict[str, Any]:
            return await get_json(
                f"{_PUBLIC_BASE}/OHLC",
                source="kraken",
                params={"pair": kp, "interval": minutes, "since": since},
            )

        payload = await cache.get_or_set(f"kraken:ohlc:{kp}:{minutes}:{since}", _OHLC_TTL, fetch)
        return parse_ohlc(payload)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -k kraken -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Run the existing kraken suite for regressions**

Run: `cd api && ./.venv/bin/pytest tests/test_kraken.py -q`
Expected: PASS (the existing `parse_ohlc`/`krakenize_pair` tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/kraken.py api/tests/test_chart_controls.py
git commit -m "feat(kraken): map span->since (bar-aligned) in get_candles"
```

---

## Task 4: IBKR adapter — implement historical candles

**Files:**
- Modify: `api/app/adapters/ibkr.py`
- Test: `api/tests/test_chart_controls.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `api/tests/test_chart_controls.py`:

```python
import httpx

from app.adapters.ibkr import IbkrAdapter, ibkr_bar, ibkr_period, parse_history


def test_ibkr_bar_and_period_tokens():
    assert ibkr_bar(Interval.M5) == "5min"
    assert ibkr_bar(Interval.M15) == "15min"
    assert ibkr_bar(Interval.H4) == "4h"
    assert ibkr_bar(Interval.W1) == "1w"
    assert ibkr_period(Span.D5) == "5d"
    assert ibkr_period(Span.M1) == "1m"
    assert ibkr_period(Span.Y5) == "5y"


def test_parse_history_keeps_ms_timestamps():
    payload = {"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 99}]}
    candles = parse_history(payload)
    assert len(candles) == 1
    c = candles[0]
    assert c.t == 1_700_000_000_000  # already ms — NOT multiplied
    assert (c.o, c.h, c.l, c.c, c.v) == (1.0, 2.0, 0.5, 1.5, 99.0)


def test_parse_history_empty_payload():
    assert parse_history({}) == []
    assert parse_history({"data": []}) == []


async def test_ibkr_get_candles_drives_history_endpoint():
    captured = {}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/tickle"):
            return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}})
        if path.endswith("/iserver/accounts"):
            return httpx.Response(200, json=[{"id": "DU1"}])
        if path.endswith("/iserver/secdef/search"):
            return httpx.Response(
                200,
                json=[{"conid": 265598, "description": "NASDAQ", "sections": [{"secType": "STK"}]}],
            )
        if path.endswith("/iserver/marketdata/history"):
            captured["query"] = dict(req.url.params)
            return httpx.Response(
                200, json={"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 9}]}
            )
        return httpx.Response(404, json={})

    a = IbkrAdapter()
    a._client = httpx.AsyncClient(
        base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler)
    )
    candles = await a.get_candles("AAPL", interval=Interval.H4, span=Span.Y1)
    assert len(candles) == 1 and candles[0].c == 1.5
    assert captured["query"]["conid"] == "265598"
    assert captured["query"]["bar"] == "4h"
    assert captured["query"]["period"] == "1y"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -k ibkr -v`
Expected: FAIL with `ImportError: cannot import name 'ibkr_bar'`.

- [ ] **Step 3: Write minimal implementation**

In `api/app/adapters/ibkr.py`:

Update the imports. Change line 24-25 from:

```python
from ..models import Candle, Position, Quote
from .base import Adapter, NotSupported, SourceUnavailable, Unauthenticated
```

to (drop `NotSupported`, now unused; add enums):

```python
from ..models import Candle, Interval, Position, Quote, Span
from .base import Adapter, SourceUnavailable, Unauthenticated
```

Add the pure mapping tables + parser near the other module-level pure helpers (after `parse_position`, around line 109):

```python
_IBKR_BAR: dict[Interval, str] = {
    Interval.M1: "1min",
    Interval.M5: "5min",
    Interval.M15: "15min",
    Interval.H1: "1h",
    Interval.H4: "4h",
    Interval.D1: "1d",
    Interval.W1: "1w",
}

_IBKR_PERIOD: dict[Span, str] = {
    Span.D1: "1d",
    Span.D5: "5d",
    Span.M1: "1m",
    Span.M3: "3m",
    Span.Y1: "1y",
    Span.Y5: "5y",
}


def ibkr_bar(interval: Interval) -> str:
    """Canonical interval -> IBKR `bar` token. Pure/testable."""
    return _IBKR_BAR[interval]


def ibkr_period(span: Span) -> str:
    """Canonical span -> IBKR `period` token. Pure/testable."""
    return _IBKR_PERIOD[span]


def parse_history(payload: dict[str, Any]) -> list[Candle]:
    """Pure: /iserver/marketdata/history payload -> canonical Candles.

    IBKR `t` is already epoch milliseconds (unlike Kraken seconds) — do NOT scale.
    """
    rows = (payload or {}).get("data") or []
    candles: list[Candle] = []
    for r in rows:
        candles.append(
            Candle(
                t=int(r["t"]),
                o=float(r["o"]),
                h=float(r["h"]),
                l=float(r["l"]),
                c=float(r["c"]),
                v=float(r.get("v") or 0),
            )
        )
    return candles
```

Replace the `get_candles` stub (lines 199-202) with the real implementation:

```python
    async def get_candles(
        self, symbol: str, interval: Interval = Interval.D1, span: Span = Span.M1
    ) -> list[Candle]:
        symbol = symbol.upper()
        await self._ensure_session()
        await self._prime()
        conid = await self._resolve_conid(symbol)
        params = {"conid": conid, "period": ibkr_period(span), "bar": ibkr_bar(interval)}
        candles: list[Candle] = []
        # The first history request can return empty while the gateway warms up.
        for _ in range(3):
            data = await self._get("/iserver/marketdata/history", params=params)
            candles = parse_history(data if isinstance(data, dict) else {})
            if candles:
                break
            await asyncio.sleep(0.4)
        return candles
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_chart_controls.py -k ibkr -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Run the existing IBKR suites for regressions**

Run: `cd api && ./.venv/bin/pytest tests/test_ibkr.py tests/test_ibkr_session.py -q`
Expected: PASS (the pure helpers and session machine are unchanged; only `get_candles` and imports moved).

- [ ] **Step 6: Commit**

```bash
git add api/app/adapters/ibkr.py api/tests/test_chart_controls.py
git commit -m "feat(ibkr): implement historical candles via /iserver/marketdata/history"
```

---

## Task 5: Routers — enum query params + echo

**Files:**
- Modify: `api/app/routers.py:74-128`
- Test: `api/tests/test_routers.py` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_routers.py`:

```python
"""End-to-end router tests for chart span/interval params (TestClient)."""

import httpx
from fastapi.testclient import TestClient

from app.deps import get_registry
from app.main import app

client = TestClient(app)


def test_chart_rejects_unknown_interval():
    r = client.get("/chart/AAPL", params={"interval": "bogus"})
    assert r.status_code == 422


def test_chart_rejects_unknown_span():
    r = client.get("/chart/AAPL", params={"span": "10Y"})
    assert r.status_code == 422


def _mock_ibkr_gateway() -> httpx.AsyncClient:
    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path.endswith("/tickle"):
            return httpx.Response(200, json={"iserver": {"authStatus": {"authenticated": True}}})
        if path.endswith("/iserver/accounts"):
            return httpx.Response(200, json=[{"id": "DU1"}])
        if path.endswith("/iserver/secdef/search"):
            return httpx.Response(
                200, json=[{"conid": 1, "description": "NASDAQ", "sections": [{"secType": "STK"}]}]
            )
        if path.endswith("/iserver/marketdata/history"):
            return httpx.Response(
                200, json={"data": [{"t": 1_700_000_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 9}]}
            )
        return httpx.Response(404, json={})

    return httpx.AsyncClient(base_url="https://gw.local/v1/api", transport=httpx.MockTransport(handler))


def test_chart_echoes_resolved_interval_and_span():
    ibkr = get_registry().get("ibkr")
    ibkr._client = _mock_ibkr_gateway()
    ibkr._conids.clear()
    ibkr._primed = False

    r = client.get("/chart/AAPL", params={"interval": "4h", "span": "1Y"})
    assert r.status_code == 200
    body = r.json()
    assert body["interval"] == "4h"
    assert body["span"] == "1Y"
    assert body["status"] == "ok"
    assert len(body["candles"]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && ./.venv/bin/pytest tests/test_routers.py -v`
Expected: FAIL — `test_chart_rejects_unknown_interval` returns 200 (param is still a plain `str`), and the echo test KeyErrors on `body["interval"]`.

- [ ] **Step 3: Write minimal implementation**

In `api/app/routers.py`, add `Interval` and `Span` to the existing `from .models import (...)` block.

Replace the `chart` handler (lines 74-91) with:

```python
@router.get("/chart/{symbol}", response_model=CandlesResponse, tags=["market"])
async def chart(
    symbol: str, interval: Interval = Interval.H1, span: Span = Span.M1
) -> CandlesResponse:
    symbol = symbol.upper()
    source = source_for_symbol(symbol)
    adapter = _adapter(source)
    if adapter is None:
        return CandlesResponse(
            status=SourceStatus.SOURCE_DOWN,
            message=f"{source} integration not available.",
            symbol=symbol,
            source=source,
            interval=interval,
            span=span,
        )
    try:
        candles = await adapter.get_candles(symbol, interval=interval, span=span)
    except Exception as exc:  # noqa: BLE001 - mapped to a UI state, never crashes
        status, msg = _status_from_exc(exc)
        return CandlesResponse(
            status=status, message=msg, symbol=symbol, source=source, interval=interval, span=span
        )
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CandlesResponse(
        status=status, symbol=symbol, source=source, candles=candles, interval=interval, span=span
    )
```

Replace the `crypto` handler (lines 112-128) with:

```python
@router.get("/crypto/{base}/{quote_ccy}", response_model=CryptoResponse, tags=["market"])
async def crypto(
    base: str, quote_ccy: str, interval: Interval = Interval.H1, span: Span = Span.M1
) -> CryptoResponse:
    pair = f"{base.upper()}/{quote_ccy.upper()}"
    source = "kraken"
    adapter = _adapter(source)
    if adapter is None:
        return CryptoResponse(
            status=SourceStatus.SOURCE_DOWN,
            message="kraken integration not available.",
            pair=pair,
            source=source,
            interval=interval,
            span=span,
        )
    try:
        q, candles = await asyncio.gather(
            adapter.get_quote(pair), adapter.get_candles(pair, interval=interval, span=span)
        )
    except Exception as exc:  # noqa: BLE001
        status, msg = _status_from_exc(exc)
        return CryptoResponse(
            status=status, message=msg, pair=pair, source=source, interval=interval, span=span
        )
    status = SourceStatus.OK if candles else SourceStatus.EMPTY
    return CryptoResponse(
        status=status, pair=pair, source=source, quote=q, candles=candles, interval=interval, span=span
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && ./.venv/bin/pytest tests/test_routers.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the full backend suite**

Run: `cd api && ./.venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/app/routers.py api/tests/test_routers.py
git commit -m "feat(api): chart/crypto accept interval+span query params and echo them"
```

---

## Task 6: Regenerate the OpenAPI TypeScript client

**Files:**
- Modify (generated): `web/app/lib/api/schema.ts`

- [ ] **Step 1: Start the backend so its OpenAPI schema is reachable**

In a separate terminal:
```bash
cd api && ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Verify: `curl -s http://127.0.0.1:8000/openapi.json | grep -o '"Interval"' | head -1`
Expected: prints `"Interval"` (the enum is now a named component schema).

- [ ] **Step 2: Regenerate the TS client**

Run:
```bash
cd web && npm run gen:api
```
Expected: `app/lib/api/schema.ts` rewritten with no error.

- [ ] **Step 3: Verify the new types exist**

Run: `cd web && grep -n "Interval\|Span" app/lib/api/schema.ts | head`
Expected: `Interval:` and `Span:` appear under `components.schemas`, and `/chart/{symbol}` / `/crypto/...` query params reference them.

- [ ] **Step 4: Commit**

```bash
git add web/app/lib/api/schema.ts
git commit -m "chore(web): regenerate OpenAPI client with Interval/Span"
```

(You can stop the uvicorn server now, or leave it running for the final verification task.)

---

## Task 7: Frontend — `resolveRange` pure module

**Files:**
- Create: `web/app/lib/chart/range.ts`
- Test: `web/app/lib/chart/range.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/chart/range.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { INTERVALS, SPANS, resolveRange, validIntervals } from "./range";

describe("resolveRange", () => {
  it("keeps the interval when it is valid for the span", () => {
    expect(resolveRange("1M", "1h")).toEqual({ span: "1M", interval: "1h" });
  });

  it("snaps the interval to the span default when the interval is invalid", () => {
    // 1m is too fine for a 1Y span -> snaps to that span's default (1d)
    expect(resolveRange("1Y", "1m")).toEqual({ span: "1Y", interval: "1d" });
  });

  it("snaps when moving from a fine span to a coarse one", () => {
    // was viewing 1D/5m, switch span to 5Y -> 5m invalid -> default 1w
    expect(resolveRange("5Y", "5m")).toEqual({ span: "5Y", interval: "1w" });
  });
});

describe("validIntervals", () => {
  it("returns the allowed intervals for a span (all within Kraken's 720-bar cap)", () => {
    expect(validIntervals("1D")).toEqual(["5m", "15m", "1h"]);
    expect(validIntervals("5Y")).toEqual(["1w"]);
  });

  it("every valid interval is a member of the full INTERVALS list", () => {
    for (const span of SPANS) {
      for (const iv of validIntervals(span)) {
        expect(INTERVALS).toContain(iv);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- range`
Expected: FAIL — cannot find module `./range`.

- [ ] **Step 3: Write minimal implementation**

Create `web/app/lib/chart/range.ts`:

```typescript
import type { Schemas } from "../api/client";

// Span/Interval are owned by the backend Pydantic enums (CLAUDE.md type
// contract); we only reference the generated types here, never redefine them.
export type Span = Schemas["Span"];
export type Interval = Schemas["Interval"];

// Display order for the two button rows.
export const SPANS: Span[] = ["1D", "5D", "1M", "3M", "1Y", "5Y"];
export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

// Which intervals are sensible for each span. CRITICAL INVARIANT: every (span,
// interval) pair here must satisfy span/interval <= 720 bars, because Kraken's
// OHLC endpoint returns at most 720 candles and silently truncates beyond that.
// (e.g. 1M/15m = 2880 bars would show only the last ~7 days, not a month.) The
// finest interval is therefore dropped from each span. Matches Bloomberg/
// TradingView muscle memory while keeping every request inside the cap.
const VALID: Record<Span, Interval[]> = {
  "1D": ["5m", "15m", "1h"],
  "5D": ["15m", "1h", "4h"],
  "1M": ["1h", "4h", "1d"],
  "3M": ["4h", "1d", "1w"],
  "1Y": ["1d", "1w"],
  "5Y": ["1w"],
};

// The interval a span snaps to when the current interval is invalid for it.
const DEFAULT_INTERVAL: Record<Span, Interval> = {
  "1D": "5m",
  "5D": "15m",
  "1M": "1h",
  "3M": "4h",
  "1Y": "1d",
  "5Y": "1w",
};

export function validIntervals(span: Span): Interval[] {
  return VALID[span];
}

// Pure: given a desired (span, interval), return a valid pair. The span is
// always honored; the interval is kept if valid for that span, otherwise snapped
// to the span's default.
export function resolveRange(span: Span, interval: Interval): { span: Span; interval: Interval } {
  const valid = VALID[span];
  return { span, interval: valid.includes(interval) ? interval : DEFAULT_INTERVAL[span] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- range`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/chart/range.ts web/app/lib/chart/range.test.ts
git commit -m "feat(web): resolveRange pure function for span/interval pairing"
```

---

## Task 8: Frontend — `ChartControls` component

**Files:**
- Create: `web/app/components/ChartControls.tsx`

(No automated test: the repo's vitest is intentionally node-only for pure functions — there are zero component tests in the codebase. The behavior-bearing logic lives in `resolveRange`/`validIntervals`, which Task 7 covers. This component is thin and presentational; it is verified in the final run-the-app task.)

- [ ] **Step 1: Create the component**

Create `web/app/components/ChartControls.tsx`:

```tsx
"use client";

import { INTERVALS, SPANS, validIntervals } from "../lib/chart/range";
import type { Interval, Span } from "../lib/chart/range";

// Two presentational button rows: chart span (lookback) and candle interval.
// Pure — props in, callbacks out. Invalid intervals for the current span render
// disabled (validity comes from the tested resolveRange/validIntervals logic).
export default function ChartControls({
  span,
  interval,
  onSpanChange,
  onIntervalChange,
}: {
  span: Span;
  interval: Interval;
  onSpanChange: (s: Span) => void;
  onIntervalChange: (i: Interval) => void;
}) {
  const allowed = validIntervals(span);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
      <Row label="Span">
        {SPANS.map((s) => (
          <Pill key={s} active={s === span} onClick={() => onSpanChange(s)}>
            {s}
          </Pill>
        ))}
      </Row>
      <Row label="Bar">
        {INTERVALS.map((i) => (
          <Pill
            key={i}
            active={i === interval}
            disabled={!allowed.includes(i)}
            onClick={() => onIntervalChange(i)}
          >
            {i}
          </Pill>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ color: "var(--muted)", fontSize: "0.7rem", width: "2.5rem" }}>{label}</span>
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Pill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#0b0e14" : disabled ? "var(--border)" : "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "0.18rem 0.55rem",
        fontSize: "0.78rem",
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck the component compiles**

Run: `cd web && npx tsc --noEmit`
Expected: no errors (this also confirms `Interval`/`Span` import cleanly from `range.ts`).

- [ ] **Step 3: Commit**

```bash
git add web/app/components/ChartControls.tsx
git commit -m "feat(web): ChartControls span/interval button rows"
```

---

## Task 9: Frontend — thread interval/span through loaders

**Files:**
- Modify: `web/app/lib/loaders.ts:21-37` and `:80-94`

- [ ] **Step 1: Update `loadChart` and `loadCrypto` to accept and pass params**

In `web/app/lib/loaders.ts`, add an import at the top for the control types:

```typescript
import type { Interval, Span } from "./chart/range";
```

Replace `loadChart` (lines 21-24):

```typescript
export async function loadChart(
  symbol: string,
  interval: Interval = "1d",
  span: Span = "1M",
): Promise<Schemas["CandlesResponse"]> {
  const { data, error } = await api.GET("/chart/{symbol}", {
    params: { path: { symbol }, query: { interval, span } },
  });
  return unwrap(data, error);
}
```

Replace `loadCrypto` (lines 31-37):

```typescript
export async function loadCrypto(
  pair: string,
  interval: Interval = "1d",
  span: Span = "1M",
): Promise<Schemas["CryptoResponse"]> {
  const [base, quoteCcy] = pair.split("/");
  const { data, error } = await api.GET("/crypto/{base}/{quote_ccy}", {
    params: { path: { base, quote_ccy: quoteCcy }, query: { interval, span } },
  });
  return unwrap(data, error);
}
```

(The defaults keep `loadQuoteData`, which calls `loadCrypto(symbol)` for quotes, working unchanged.)

- [ ] **Step 2: Update `loadChartData` to thread the params**

Replace `loadChartData` (lines 87-94):

```typescript
export async function loadChartData(
  symbol: string,
  interval: Interval = "1d",
  span: Span = "1M",
): Promise<ChartData> {
  if (routeSymbol(symbol) === "kraken") {
    const r = await loadCrypto(symbol, interval, span);
    return { status: r.status, message: r.message, source: r.source, candles: r.candles };
  }
  const r = await loadChart(symbol, interval, span);
  return { status: r.status, message: r.message, source: r.source, candles: r.candles };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/app/lib/loaders.ts
git commit -m "feat(web): thread interval/span through chart loaders"
```

---

## Task 10: Frontend — wire `ChartWidget` state + controls

**Files:**
- Modify: `web/app/widgets/ChartWidget.tsx`

- [ ] **Step 1: Replace the widget with stateful version**

Replace the entire contents of `web/app/widgets/ChartWidget.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import CandleChart from "../components/CandleChart";
import ChartControls from "../components/ChartControls";
import { ResourceView, WidgetFrame } from "../components/ui";
import { resolveRange } from "../lib/chart/range";
import type { Interval, Span } from "../lib/chart/range";
import { loadChartData } from "../lib/loaders";
import { useResource } from "../lib/useResource";

export default function ChartWidget({ symbol }: { symbol: string }) {
  const [span, setSpan] = useState<Span>("1M");
  const [interval, setInterval] = useState<Interval>("1h");

  const load = useCallback(() => loadChartData(symbol, interval, span), [symbol, interval, span]);
  const { state, refresh } = useResource(load);
  const source = state.kind === "ok" ? state.data.source : undefined;

  // Picking a span may snap the interval (resolveRange) so the pair stays valid.
  const selectSpan = (s: Span) => {
    const r = resolveRange(s, interval);
    setSpan(r.span);
    setInterval(r.interval);
  };

  return (
    <WidgetFrame title={`Chart · ${symbol}`} source={source} onRefresh={refresh} busy={state.kind === "loading"}>
      <ChartControls
        span={span}
        interval={interval}
        onSpanChange={selectSpan}
        onIntervalChange={setInterval}
      />
      <ResourceView state={state}>
        {(data) =>
          data.candles.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No candles.</p>
          ) : (
            <CandleChart candles={data.candles} />
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
```

(Changing `span` or `interval` re-keys the `useCallback`, so `useResource` refetches automatically — consistent with the existing on-demand hook contract. `ChartControls` renders above `ResourceView` so the buttons stay usable during loading/error states.)

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build to confirm no runtime/type breakage**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/app/widgets/ChartWidget.tsx
git commit -m "feat(web): ChartWidget span/interval controls with auto-snap refetch"
```

---

## Task 11: Final verification (whole feature)

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

Run: `cd api && ./.venv/bin/pytest -q`
Expected: all PASS.

- [ ] **Step 2: Full frontend test suite**

Run: `cd web && npm run test`
Expected: all PASS (including `range.test.ts` and existing parser/router/tabs tests).

- [ ] **Step 3: Frontend typecheck + build**

Run: `cd web && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 4: Manual smoke test (run the app)**

Start backend (`cd api && ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000`) and frontend (`cd web && npm run dev`), then in the UI:
- `crypto BTC/USD` → confirm the Span and Bar rows render; clicking `1D` snaps Bar to `5m` and the chart refetches; clicking an enabled Bar refetches; intervals outside the span's set are disabled.
- `chart AAPL` → if the IBKR gateway is logged in, candles render and controls drive refetches; if not, the existing "log in at the gateway" state shows (controls still visible, no crash).

Expected: no console errors; loading state shows on each refetch; invalid intervals are visibly disabled.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: verify chart span/interval controls end-to-end"
```

(If nothing changed in this task, skip the commit.)
