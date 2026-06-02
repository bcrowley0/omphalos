# Swaps Widget (CFTC SDR) — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) → ready for implementation plan
**Command:** `swaps`

## Goal

A read-only `swaps` widget that shows **SOFR** interest-rate swaps and **US CPI**
(zero-coupon inflation) swaps, sourced from a **CFTC-registered Swap Data
Repository**. Display is a **rate-by-tenor summary**: for each standard tenor, the
representative (median) fixed rate plus trade count and total notional — one
section for SOFR, one for US CPI, for the latest available end-of-day file.

## Data source (verified)

DTCC Data Repository (DDR) — a CFTC-registered SDR — publishes free, no-auth,
machine-downloadable end-of-day cumulative files via its Public Price
Dissemination platform:

```
https://kgc0418-tdw-data-0.s3.amazonaws.com/cftc/eod/CFTC_CUMULATIVE_RATES_{YYYY_MM_DD}.zip
```

- One ZIP (~1 MB) → one CSV (~13 MB, ~22k rows), header row, 110 columns, every
  field quoted.
- "CUMULATIVE" = all messages disseminated for that UTC report day.
- Retention: ~366 days back from today; availability from 2023-12-29.
- **It is a raw transaction tape, not a rate curve.** Each row is one anonymized
  swap print. A "rate" is derived by bucketing prints into tenors and taking a
  representative statistic.

### Fields used (by header name)

| Column name | Use |
|---|---|
| `Action type` | keep `NEWT` (new trades); skip `MODI`/`TERM`/cancels to avoid double counting |
| `Asset Class` | sanity filter `IR` (all rates incl. inflation) |
| `Effective Date` / `Expiration Date` | tenor = (expiration − effective) |
| `Fixed rate-Leg 1` / `Fixed rate-Leg 2` | the fixed rate (decimal → ×100 = %) |
| `Notional amount-Leg 1` / `Notional amount-Leg 2` | notional; trailing `+` = capped |
| `Notional currency-Leg 1` / `-Leg 2` | confirm `USD` |
| `UPI Underlier Name` | **primary classifier** (SOFR vs CPI vs other) |

### Classification (verified strings)

- **SOFR:** `UPI Underlier Name` contains `USD-SOFR` **and** does **not** contain
  ` vs ` (the ` vs ` excludes basis / cross-currency legs). Casing/spelling varies
  (`USD-SOFR-OIS Compound`, `USD-SOFR-COMPOUND`, …) → normalize before matching.
- **US CPI:** `UPI Underlier Name == USA-CPI-U`. (Exclude other inflation
  underliers such as `EUR-EXT-CPI`, `UK-RPI`.)

## Architecture

Follows the existing vertical slice (adapter → registry → router → generated TS
client → loader → widget), mirroring the FRED / yield-curve path since this is
EOD macro data.

```
DTCC S3 ZIP ──> SdrAdapter (fetch+unzip+filter+normalize) ──> registry["sdr"]
                       │
                GET /swaps (router)  ──OpenAPI──> schema.ts ──> loadSwaps()
                       │                                              │
                SwapsResponse (canonical)                       SwapsWidget
```

## Backend

### Canonical model (`api/app/models.py`)

New normalized shapes (camelCase on the wire via the existing `CamelModel`):

```python
class SwapTenorPoint(CamelModel):
    tenor_label: str          # "1Y", "2Y", ... "30Y"
    tenor_years: float        # standard bucket value (e.g. 10.0)
    rate_pct: float           # median fixed rate, percent
    trade_count: int          # prints in this bucket
    total_notional: float     # summed notional (USD); capped prints counted at cap

class SwapCurve(CamelModel):
    key: str                  # "sofr" | "cpi"
    label: str                # "SOFR OIS" | "US CPI (zero-coupon)"
    obs_date: int             # UTC epoch ms of the file's report date
    points: list[SwapTenorPoint] = []

class SwapsResponse(CamelModel):
    status: SourceStatus
    message: str | None = None
    file_date: int | None = None   # UTC epoch ms of the EOD file actually used
    curves: list[SwapCurve] = []
```

### Base adapter capability (`api/app/adapters/base.py`)

Add (raises `NotSupported` by default, matching the existing pattern):

```python
async def get_swap_rates(self) -> list[SwapCurve]:
    raise NotSupported(f"{self.name} does not support swap rates")
```

### HTTP helper (`api/app/http.py`)

Add `get_bytes(url, *, source, ...) -> bytes` mirroring `get_json`/`get_text`
(returns `resp.content`). Reuses the single outbound choke point: structured
logging + the existing status→exception mapping (404/4xx → `SourceUnavailable`,
429 → `RateLimited`).

### Adapter (`api/app/adapters/sdr.py`, `name = "sdr"`)

**Impure shell** — `get_swap_rates()`:
1. Build candidate dates: today UTC, walking back up to 5 calendar days.
2. For each, fetch the ZIP via `get_bytes`. A missing file surfaces as
   `SourceUnavailable` (S3 404) — catch it and try the previous day.
3. First success: unzip in memory (`zipfile.ZipFile(io.BytesIO(content))`), read
   the single CSV member as text.
4. Cache the resolved (file_date → curves) result with a long TTL (e.g. 3600s),
   keyed by the resolved date, so re-fetch within a day is free.
5. If no candidate in the window succeeds, raise `SourceUnavailable`.

**Pure core** (each small, individually unit-tested; mirrors `fred.py` style):
- `classify_underlier(name: str) -> "sofr" | "cpi" | None`
- `pick_fixed_rate(row: dict) -> float | None` — first populated leg, ×100
- `parse_notional(raw: str) -> tuple[float, bool]` — strip commas, trailing `+`
  → `(value, capped)`; non-numeric → `(0.0, False)`
- `tenor_years(effective: str, expiration: str) -> float | None` — day delta / 365.25
- `bucket_tenor(years: float) -> tuple[str, float] | None` — nearest standard
  tenor within tolerance (e.g. ±10% of bucket spacing); else None (dropped)
- `aggregate(rows) -> list[SwapTenorPoint]` — group by bucket → median rate,
  count, summed notional; sorted by tenor_years
- `parse_rates_csv(text: str) -> list[SwapCurve]` — the full pure transform from
  CSV text to `[SwapCurve(sofr), SwapCurve(cpi)]`. Filters `Action type == NEWT`,
  `Asset Class == IR`, valid rate/dates; classifies; buckets; aggregates.

Standard tenors: `1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 15Y, 20Y, 30Y`.

### Router (`api/app/routers.py`)

```python
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
    file_date = next((c.obs_date for c in curves), None)  # shared report date
    status = SourceStatus.OK if any(c.points for c in curves) else SourceStatus.EMPTY
    return SwapsResponse(status=status, file_date=file_date, curves=curves)
```

`get_swap_rates()` returns `list[SwapCurve]` (both carrying the same `obs_date` =
the resolved file's report date); the router echoes that as `file_date`. No
separate adapter method is needed. Register `SdrAdapter()` in `api/app/deps.py`.

## Frontend

1. **Regenerate types:** `npm run gen:api` (backend running) — pulls in
   `SwapsResponse`, `SwapCurve`, `SwapTenorPoint`. No hand-written interfaces.
2. **Loader** (`web/app/lib/loaders.ts`): `loadSwaps(): Promise<Schemas["SwapsResponse"]>`
   wrapping `api.GET("/swaps")`.
3. **Command** — `parser.ts` `case "swaps": return { kind: "swaps" }`; add
   `{ kind: "swaps" }` to the `Command` union and `"swaps"` to `WidgetKind` in
   `types.ts`; `tabs.ts` → `{ id: "swaps", widget: "swaps", title: "Swaps" }`.
4. **Widget** (`web/app/widgets/SwapsWidget.tsx`): `useResource(loadSwaps)`,
   `WidgetFrame` (manual refresh, no auto-refresh toggle), `ResourceView`. Renders
   the file date + an EOD/anonymized-data sub-note in the header, then two stacked
   rate-by-tenor tables (Tenor / Rate % / Trades / Notional) — SOFR then US CPI —
   reusing `fmt`/`signColor` from `ui.tsx`. Empty curve → "No SOFR/CPI prints in
   this file."
5. **Wire into the widget host** switch (where `WidgetKind` → component is mapped;
   `WidgetHost.tsx` / `page.tsx`).
6. **Help** — add `swaps` to `HelpWidget.tsx`'s command list.

**No auto-refresh:** EOD data (one new file per UTC day) and not in the live-data
widget set (quote/watchlist/portfolio/chart) per CLAUDE.md rule 5.

## Error / empty states (rule 6)

| State | Trigger |
|---|---|
| loading | client-side while fetching |
| source_down | S3 unreachable, or no file found in the 5-day walk-back window |
| empty | file fetched but no SOFR/CPI prints survived filtering |
| rate_limited | HTTP 429 (unlikely from S3) |

No `unauthenticated` state — the source is public. All surfaced via the standard
envelope + `ResourceView`; never an unhandled crash.

## Caveats surfaced to the user

- Values are **median fixed rates of EOD prints**, not official benchmark rates.
- Notionals are **anonymized and capped** (large trades counted at their cap).
- Tenor is derived from effective/expiration dates and bucketed to the nearest
  standard tenor.
A concise header sub-note states this.

## Testing

**Backend** (`api/tests/test_sdr.py`): a small fixture CSV exercising —
- a clean SOFR OIS print (correct leg/rate/tenor),
- a `USA-CPI-U` print,
- a capped `250,000,000+` notional (parsed value + capped flag),
- a basis ` vs ` SOFR row (must be **excluded**),
- a non-USD `EUR-EXT-CPI` row (must be **excluded**),
- a `MODI`/`TERM` row (must be **excluded**),
- two SOFR prints in the same tenor bucket (median assertion).

Covers `classify_underlier`, `parse_notional`, `tenor_years`, `bucket_tenor`,
`aggregate`, and `parse_rates_csv` end-to-end. Plus a `/swaps` router test with a
stubbed `sdr` adapter (OK, EMPTY, and an exception → mapped status), mirroring
`test_routers.py`.

**Frontend:** `parser.test.ts` (`swaps` → `{ kind: "swaps" }`), `tabs.test.ts`
(`swaps` tab id/title), and a `SwapsWidget` render test matching existing widget
test style (renders both sections from a mocked `loadSwaps`).

## Compliance with CLAUDE.md

- Backend proxy mandatory ✓ (browser never calls DTCC).
- No secrets ✓ (public source; nothing in `.env`).
- Adapter + registry ✓; a broken source degrades gracefully ✓.
- Read-only ✓; `place_order` untouched.
- Snapshot / on-demand ✓; no websockets/streaming ✓; no auto-refresh (EOD).
- Explicit UI states for loading/source-down/rate-limited/empty ✓.
- Types generated from OpenAPI ✓; no duplicate hand-written TS.
- Canonical internal model: new `SwapTenorPoint`/`SwapCurve` normalized at the
  adapter boundary; timestamps epoch-ms ✓.

## Out of scope (v1, YAGNI)

As-of/historical date picker, `swaps sofr` / `swaps cpi` argument variants,
intraday slice files, volume-weighting, outlier statistics beyond the median,
other inflation indices, and the SEC/CA jurisdiction files.
