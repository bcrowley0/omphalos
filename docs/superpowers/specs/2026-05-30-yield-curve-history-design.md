# Yield Curve — Historical Curves & BP-Change Columns

**Date:** 2026-05-30
**Status:** Design — approved for planning
**Scope:** Extend the `yield` widget from a single latest curve to multiple as-of
curves (relative or exact date) overlaid on the chart, plus per-tenor basis-point
change columns measured against the current curve.

---

## Goal

Today the `yield` widget fetches the latest observation of 11 Treasury
constant-maturity series and renders one curve + a `Tenor | Rate %` table. This
adds:

1. **Historical curves.** Pull a rolling daily history so the widget can show the
   curve as of any prior date — by relative period (`1d, 1w, 1m, 3m, 6m, 1y`) or an
   exact calendar date.
2. **BP-change columns.** For each comparison curve, show the per-tenor change in
   basis points measured as `current − comparison`.
3. **User control.** A settings popover lets the user choose which comparison
   curves are drawn on the chart and which Δ columns are shown. State persists in
   `localStorage`.
4. **Default view.** Current curve + 1-week-ago curve overlaid; all six relative Δ
   columns (1d/1w/1m/3m/6m/1y) shown.

### Unifying concept: the *comparison curve*

A comparison curve is identified by **either** a relative lookback **or** an exact
date, and carries two independent toggles: *show on chart* and *show Δ column*.
`current` (the latest available curve) is always the reference; its Δ is 0 by
definition. The fixed relative columns and any user-added exact-date curves are the
same kind of object — the only difference is their default toggle state.

### Out of scope (YAGNI)

- No animated time-scrubber.
- No arbitrary date *ranges* — only discrete as-of curves.
- No new series IDs beyond the existing 11.

---

## Architecture decision

**Fetch a rolling ~13-month daily history once; resolve as-of curves in memory;
compute Δs client-side.**

- Backend fetches `observation_start ≈ today − 400 days` for all 11 series in one
  pass (same 11 sequential calls as today, with a date range), caching the
  **history** under `fred:curve:history` (60s TTL).
- The `/yield` endpoint resolves any requested as-of date from the cached history by
  picking the latest valid observation **on or before** the target date — naturally
  handling weekends, holidays, and FRED `"."` missing markers.
- Δs are computed **client-side** by a pure, unit-tested TS util. The backend
  contract stays "give me curves as of these dates"; the client already holds both
  curves for the legend/table, so this avoids duplicating trivial arithmetic and
  keeps the response shape stable.

Rejected alternative: backend returns a full Δ matrix — bloats the contract and
duplicates math the client needs anyway.

---

## Backend

### Data model (`api/app/models.py`)

`YieldPoint` is unchanged. A new wrapper and a revised envelope:

```python
class AsOfCurve(CamelModel):
    key: str            # "current" | "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | "2026-01-15"
    label: str          # "Today" | "1W ago" | "Jan 15, 2026"
    requested_date: int # target as-of (epoch ms); equals latest obs date for "current"
    obs_date: int       # actual observation date used (epoch ms, <= requested_date)
    points: list[YieldPoint]

class YieldCurveResponse(CamelModel):   # replaces the old points-only shape
    status: SourceStatus
    message: str | None = None
    curves: list[AsOfCurve] = []        # key="current" first when status == ok
```

**Wire format** (camelCase via existing `to_camel` alias generator): `key`, `label`,
`requestedDate`, `obsDate`, `points`.

> **Contract note:** removing the old top-level `points` field is a breaking change.
> The frontend type is regenerated from OpenAPI (`gen:api`), so any missed call site
> fails the build rather than at runtime — per the CLAUDE.md type contract.

### Endpoint (`api/app/routers.py`)

```
GET /yield
GET /yield?asof=2026-01-15&asof=2025-11-30
```

- Always returns `current` + the six presets (`1d, 1w, 1m, 3m, 6m, 1y`).
- Each repeated `asof=YYYY-MM-DD` query param appends an exact-date curve (validated;
  malformed dates → `400`-style empty curve with a message, not a crash).
- The existing status/exception mapping (`Unauthenticated`, `RateLimited`,
  `SourceUnavailable`, `NotSupported`) is unchanged.

### Adapter (`api/app/adapters/fred.py`)

New / changed internals, all pure where possible for unit testing:

- `get_yield_history() -> YieldHistory` — one pass over the 11 series with
  `observation_start ≈ today − 400 days`, reusing the current sequential-fetch +
  stagger + transient-retry logic. Cached under `fred:curve:history` (60s TTL).
  `YieldHistory` holds, per series, observations sorted by date with `"."` markers
  dropped, alongside the tenor metadata (label, years).
- `relative_target(current_ms: int, period: str) -> int` — calendar subtraction from
  the latest observation date: `1d`=−1 day, `1w`=−7 days, `1m`/`3m`/`6m`=−N months,
  `1y`=−1 year.
- `resolve_as_of(history, target_ms) -> list[YieldPoint]` — per series, the latest
  valid observation on or before `target_ms`; aligns output by tenor; omits a tenor
  with no valid observation in range.
- `get_yield_curve(asof_dates: list[date]) -> list[AsOfCurve]` — builds `current`,
  the six relative curves, and one curve per requested exact date, from the cached
  history. An exact date older than the cached window widens the history fetch for
  that call.

FRED request params per series add `observation_start`; `sort_order=asc` for the
range fetch (full window, not just the latest 8 rows). All series IDs and tenor
mappings are unchanged.

### Caching (`api/app/cache.py`)

- New key `fred:curve:history` (60s TTL) holds the full history. As-of resolution is
  in-memory, so per-request `asof` params do not multiply cache entries.
- The old `fred:curve` latest-only key is removed (superseded).

---

## Frontend

### State model (`localStorage`-persisted)

```ts
type ComparePeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

type CompareCurve =
  | { kind: "relative"; period: ComparePeriod; onChart: boolean; showDelta: boolean }
  | { kind: "exact"; date: string /* YYYY-MM-DD */; onChart: boolean; showDelta: boolean };

type YieldPrefs = {
  currentOnChart: boolean;     // current curve drawn on chart
  compares: CompareCurve[];
};
```

**Default `YieldPrefs`:**

| Curve   | onChart | showDelta |
|---------|---------|-----------|
| current | ✓       | — (reference) |
| 1w      | ✓       | ✓ |
| 1d      | ✗       | ✓ |
| 1m      | ✗       | ✓ |
| 3m      | ✗       | ✓ |
| 6m      | ✗       | ✓ |
| 1y      | ✗       | ✓ |

So on first open the chart shows current + 1w, and the table shows all six relative
Δ columns.

### Pure util (`web/app/lib/`, unit-tested)

```ts
computeDeltaBp(current: YieldPoint[], comparison: YieldPoint[]):
  Record<tenorLabel, number | null>
```

Per tenor: `(currentRatePct − comparisonRatePct) * 100`, aligned by `tenorLabel`,
`null` where the tenor is missing on either side.

### Data fetching (`web/app/lib/loaders.ts`)

`loadYield(asof: string[])` passes the exact-date list as repeated `asof` query
params. Adding/removing an exact date re-fetches (snapshot/on-demand model). Relative
curves require no param — they are always returned.

### UI (`web/app/widgets/YieldWidget.tsx`)

- **Chart (`CurveSvg`):** plots multiple lines. Y-axis normalizes across all visible
  curves' rates; X-axis stays tenor-indexed. Each curve gets a distinct color. A
  **legend** lists each visible curve's label, color, and resolved obs date.
- **Settings popover:** gear button in the widget header (matching the chart
  span/interval controls pattern). Lists `current` + the six presets + any added
  exact dates, each with two checkboxes (*Chart* / *Δ*). Includes an "Add exact date"
  date input and a reset-to-defaults action.
- **Table:** rows = tenors; columns = `Tenor | Current % | <Δ per visible comparison>`.
  Δ cells render signed basis points, green for positive / red for negative. Each Δ
  column header shows the comparison label and its resolved date.

---

## Error handling & UI states

The status contract is unchanged (`loading / ok / empty / source_down /
unauthenticated / rate_limited`). Additional graceful cases:

- **Exact date with no data in range** → that curve's `points` is empty; legend shows
  "no data for <date>"; other curves still render.
- **Tenor missing on a comparison date** → blank Δ cell; the comparison line skips
  that point (no interpolation).
- **Malformed `asof` param** → message on the response, no crash.

A broken FRED source must never crash the widget (CLAUDE.md hard rule #3, #6).

---

## Testing

**Python (pytest):**
- `relative_target` — day/week/month/year subtraction from a fixed reference date.
- `resolve_as_of` — weekend, holiday, `"."` missing marker, missing-tenor, and
  exact-hit cases; verifies "latest on or before" selection.
- Endpoint — `asof` param parsing, malformed-date handling, `current`-first ordering.

**TypeScript:**
- `computeDeltaBp` — alignment by tenor, sign correctness, missing-tenor → `null`.

**Type contract:**
- Regenerate `schema.ts` via `gen:api` after the model change; the build must fail if
  any call site still references the removed `points` field.

---

## Files touched

| File | Change |
|------|--------|
| `api/app/models.py` | Add `AsOfCurve`; revise `YieldCurveResponse`. |
| `api/app/adapters/fred.py` | `get_yield_history`, `relative_target`, `resolve_as_of`, revised `get_yield_curve`. |
| `api/app/routers.py` | `/yield` accepts repeated `asof` params; build `AsOfCurve` list. |
| `api/app/cache.py` | New `fred:curve:history` key; drop `fred:curve`. |
| `web/app/lib/api/schema.ts` | Regenerated from OpenAPI. |
| `web/app/lib/loaders.ts` | `loadYield(asof[])`. |
| `web/app/lib/` (new util) | `computeDeltaBp`. |
| `web/app/widgets/YieldWidget.tsx` | Multi-line chart, legend, settings popover, Δ table. |
| Tests | Python + TS as above. |
