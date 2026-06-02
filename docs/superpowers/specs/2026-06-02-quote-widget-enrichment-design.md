# Quote Widget Enrichment — Design

Date: 2026-06-02
Status: Approved (pending implementation plan)

## Goal

Enrich the quote widget beyond `last / bid / ask / day-change` to show:

- **Day stats**: open, day high, day low, volume, VWAP.
- **Range / fundamentals**: 52-week high/low, market cap.
- **Multi-period price change ladder**: `1D 1W 1M 3M YTD 1Y 5Y` (% change).

All within existing project constraints: read-only, snapshot/on-demand with
bounded auto-refresh, adapter pattern with graceful missing fields, backend
Pydantic models as the single source of truth (frontend TS generated from
OpenAPI), explicit UI states, no websockets.

## Scope decisions (from brainstorming)

- **Full scope**: snapshot extras **plus** the multi-period change ladder.
- **Period set**: `1D 1W 1M 3M YTD 1Y 5Y` (7 periods). All computed from one
  daily-candle fetch (~5Y) per symbol.
- **Market cap**: show only when the source provides it (IBKR equities); hidden
  for crypto/Kraken.
- **Auto-refresh**: re-fetch everything (snapshot + ladder) on each interval.
  The backend TTL cache absorbs the repeated daily-history fetch so the source
  is never hammered.

## Chosen approach

**Single enriched `/quote` endpoint** (Approach A of three considered).

The existing `/quote` route resolves the adapter (IBKR vs Kraken via the symbol
router), gets the enriched snapshot, **and** fetches ~5Y of daily candles via the
same adapter's `get_candles`, then a pure `compute_period_changes()` builds the
ladder. `QuoteResponse` carries both the enriched `Quote` and the
`periodChanges` list. The widget loads one resource (fits the existing
`useResource` / `loadQuoteData` pattern); "refresh everything" re-runs this one
call.

Rejected:
- **Two endpoints** (quote + stats): independent refresh unused given the
  "refresh everything" decision; doubles frontend wiring.
- **Frontend-computed ladder** from `/candles`: puts financial math in TS,
  duplicates logic, violates "backend is the single source of truth / pure
  tested functions".

## Model changes (`api/app/models.py`)

Extend `Quote` with all-optional day stats (each adapter fills what it can;
`None` = unsupported, rendered gracefully):

```python
day_open: float | None = None
day_high: float | None = None
day_low: float | None = None
volume: float | None = None
vwap: float | None = None
week52_high: float | None = None
week52_low: float | None = None
market_cap: float | None = None
```

New model + `QuoteResponse` additions:

```python
class PeriodChange(CamelModel):
    period: str                # "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "5Y"
    change: float | None
    change_pct: float | None
    ref_close: float | None    # the close we compared against

# QuoteResponse gains:
period_changes: list[PeriodChange] = []
period_status: SourceStatus = SourceStatus.OK   # explicit visible state (rule 6):
                                                 # a failed history fetch is surfaced
                                                 # while the live quote still renders
```

JSON field names are camelCase on the wire via the existing `CamelModel` alias
generator (`dayOpen`, `dayHigh`, `changePct`, `periodChanges`, `periodStatus`, …).

## Data sources (per adapter — graceful missing fields)

| Field            | Kraken (crypto)        | IBKR (equities)        |
| ---------------- | ---------------------- | ---------------------- |
| day open         | ticker `o`             | field code 7295        |
| day high         | ticker `h[1]` (24h)    | field code 70          |
| day low          | ticker `l[1]` (24h)    | field code 71          |
| volume           | ticker `v[1]` (24h)    | field code 87          |
| VWAP             | ticker `p[1]` (24h)    | — (None; not in snapshot) |
| 52-week high/low | — (None)               | field codes 7293 / 7294 |
| market cap       | — (None)               | field code 7289        |

- **Kraken** (`parse_ticker`): the ticker payload already contains every day-stat
  field we currently discard — map them through. Kraken high/low/volume/vwap are
  the 24h values (`[1]` index of each array).
- **IBKR** (`parse_snapshot` + `_FIELDS`): add the new numeric field codes to the
  snapshot request and parse them with the existing `_num()` helper.
  **VERIFY-FIRST CONSTRAINT (`.claude/rules/ibkr.md`):** the codes above
  (70, 71, 7289, 7293, 7294) are candidates — verify each against IBKR's official
  Client Portal Web API field-code reference before relying on it. Do NOT ship a
  guessed mapping. If a code cannot be verified, leave that field unmapped (None)
  rather than guess.
- **Mock adapter** (`mock.py`): populate all new fields with plausible values so
  dev and tests exercise the full UI.

## Period-ladder computation (pure, unit-tested)

New pure function `compute_period_changes(candles, now_ms) -> list[PeriodChange]`
(new module `api/app/quotes.py`):

- Input: daily candles sorted ascending — one
  `get_candles(symbol, interval=Interval.D1, span=Span.Y5)` call.
- For each period: find the close at-or-before `now_ms − periodMs`;
  `change = last_close − ref_close`, `change_pct = change / ref_close * 100`.
- **1D** = latest close vs prior day's close (matches the snapshot day change).
- **YTD** = vs the last close of the previous calendar year (derive the
  year boundary from `now_ms` in UTC).
- If history is missing/too short for a given period → that period's
  `change`/`change_pct`/`ref_close` are `None` (the period is still listed).
- If the whole history fetch fails → caller sets `period_changes=[]` and
  `period_status` to the mapped source status.

Period→lookback (ms) reuses calendar approximations consistent with existing
`SPAN_MS`; `1W` = 7 days, `YTD` = computed boundary (not a fixed ms).

## Endpoint (`api/app/routers.py` `/quote`)

After building the enriched quote:

1. Fetch daily candles through the **same resolved adapter**:
   `get_candles(r.symbol, interval=Interval.D1, span=Span.Y5)`.
2. `compute_period_changes(candles, now_ms)` → `period_changes`.
3. Wrap the history fetch/compute in its own `try/except` mapping source errors
   to `period_status` (reuse the existing error→SourceStatus mapping). A history
   failure sets `period_status` but **never drops the quote**.
4. Quote-fetch failures keep today's existing error mapping and short-circuit as
   they do now.

## Frontend (`web/app/widgets/QuoteWidget.tsx` + generated types)

- Run `npm run gen:api` against the running backend to regenerate
  `app/lib/api/schema.ts`. `Quote`, `PeriodChange`, `QuoteResponse` flow into the
  widget with zero hand-written types.
- Extend `QuoteData` (in `loaders.ts`) to carry `periodChanges` and
  `periodStatus` from the `QuoteResponse`.
- Widget layout, top to bottom:
  - **Header** (existing): last price + day change / %.
  - **Period ladder**: compact row/grid `1D 1W 1M 3M YTD 1Y 5Y`, each with
    sign-colored `changePct` (reuse `signColor` / `fmt`). `null` periods show
    `—`. If `periodStatus !== "ok"`, render a small inline `StatusNotice`
    ("history unavailable") under the ladder; the quote still renders.
  - **Day stats** rows: open, high, low, volume, VWAP — each row hidden when its
    value is `null`.
  - **Range / fundamentals**: 52-week high/low, market cap — shown only when
    present (crypto omits them).
  - **bid / ask** (existing).
- **Settings menu**: add toggles `Show period changes` and `Show day stats`
  (consistent with existing `WidgetSettingsMenu` / `ToggleRow` and the
  `widgetSettings` prefs/coerce helpers), defaulting on. Existing `showSource`
  and `showStale` toggles unchanged.

## Testing

- **Backend (pytest):**
  - `compute_period_changes`: normal ladder; short history → some `None`; YTD
    boundary; empty input → `[]`.
  - `parse_ticker` (Kraken): asserts the new day-stat fields are populated from a
    representative ticker payload.
  - `parse_snapshot` (IBKR): asserts the new (verified) field codes map to the
    new fields and missing codes yield `None`.
  - `/quote` endpoint: history-failure path sets `period_status` without dropping
    the quote.
- **Frontend (vitest):**
  - Ladder renders with mixed present/`null` periods.
  - Absent day-stat rows are hidden; market cap shown only when present.
  - `period_status` notice renders on history failure.
  - Settings toggles hide/show the ladder and day-stat blocks.

## Constraints honored

Read-only ✓ · snapshot/on-demand, bounded auto-refresh unchanged ✓ · adapter
pattern with graceful missing fields ✓ · backend Pydantic single source of truth,
TS generated from OpenAPI ✓ · explicit UI states incl. new `period_status` ✓ ·
no websockets / no streaming ✓ · IBKR field codes verified against official docs
before use ✓.
