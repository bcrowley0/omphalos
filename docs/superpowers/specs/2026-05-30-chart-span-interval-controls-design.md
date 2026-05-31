# Chart span + interval controls — design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Goal

Add two button rows to the chart widget so the user can switch:

- **Candle size (interval):** `1m · 5m · 15m · 1h · 4h · 1d · 1w`
- **Chart span (lookback window):** `1D · 5D · 1M · 3M · 1Y · 5Y`

Span and interval are paired ("pro terminal" feel): picking a span auto-snaps
interval to a sensible default, but the user may override interval to any size
that is *valid* for that span. Full coverage for both sources — Kraken (crypto)
and IBKR (equities). IBKR candles, currently a `NotSupported` stub, get
implemented as part of this work.

## Non-goals

- No streaming / websockets (snapshot-on-demand only, per CLAUDE.md).
- No client-side zoom hack — the backend returns the windowed data; the chart
  just renders and `fitContent()`s it.
- No new data sources.

## UX: the two controls and how they relate

A new presentational component `ChartControls` renders two button groups (Span
row, Interval row) above the chart. It is pure — props in, callbacks out — and
holds no fetching logic.

Pairing is governed by a pure, unit-tested function `resolveRange(span, interval)`:

- Each span has a default interval and a set of valid intervals.
- Picking a span **auto-snaps** interval to that span's default.
- The user may then override interval to any interval in the span's valid set;
  intervals outside the valid set render **disabled**.
- The function guarantees the resulting (span, interval) pair never exceeds the
  per-source candle-count caps (Kraken ~720 points; IBKR period/bar limits).

Indicative span → default interval mapping (final values tuned in implementation
against source caps):

Every (span, interval) pair must stay within Kraken's hard 720-candle cap
(span/interval ≤ 720 bars), or Kraken silently truncates and the chart shows only
the tail of the requested window. The finest interval is therefore dropped from
each span:

| Span | Default interval | Valid intervals | Max bars (coarsest→finest) |
|------|------------------|-----------------|----------------------------|
| 1D   | 5m               | 5m, 15m, 1h     | 24 – 288                   |
| 5D   | 15m              | 15m, 1h, 4h     | 30 – 480                   |
| 1M   | 1h               | 1h, 4h, 1d      | 30 – 720                   |
| 3M   | 4h               | 4h, 1d, 1w      | 13 – 540                   |
| 1Y   | 1d               | 1d, 1w          | 52 – 365                   |
| 5Y   | 1w               | 1w              | 260                        |

Rejected alternative: fully independent rows with no snapping. Rejected because
it permits nonsensical requests (e.g. 5Y of 1m candles) and breaks the muscle
memory users have from Bloomberg/TradingView.

## Type contract (Pydantic = source of truth)

Per CLAUDE.md, backend Pydantic models drive the TS types via OpenAPI; no
hand-written duplicate interfaces.

- Add `Interval` and `Span` str-enums in `api/app/models.py`.
- Use them as the query-param types on `/chart/{symbol}` and
  `/crypto/{base}/{quote_ccy}`. The frontend always sends a `resolveRange`-d
  (span, interval) pair, so the server-side param defaults are only a fallback
  for direct API calls; they must be internally consistent — default `span=1M`
  with its snap-default `interval=1h` (final defaults set in implementation).
- **Echo** the resolved `interval` and `span` back in `CandlesResponse` and
  `CryptoResponse` so the UI reflects what it actually received (and can
  re-sync its button highlight after an auto-snap).
- An invalid enum value yields FastAPI's 422, surfaced through the existing
  error state — never an unhandled crash (CLAUDE.md hard rule 6).

## Adapter changes

Base interface becomes `get_candles(self, symbol, interval, span)`. Each adapter
maps the canonical (interval, span) to its native parameters and normalizes the
result to the canonical `Candle` shape.

### Kraken (`api/app/adapters/kraken.py`)

- Extend `_INTERVAL_MINUTES` as needed for the interval set.
- Compute `since = now_ms − span_ms` and pass it to the OHLC endpoint; rely on
  `resolveRange` to keep the request under Kraken's ~720-point cap.
- Continue caching keyed on pair + interval (+ since bucket).

### IBKR (`api/app/adapters/ibkr.py`)

- Replace the `NotSupported` stub with a real implementation against
  `/iserver/marketdata/history`.
- Resolve `symbol → conid` via the existing cached resolver.
- Map interval → `bar` and span → `period`. **Verify the exact `bar`/`period`
  tokens and the response field names against IBKR's official docs before
  coding** (per `.claude/rules/ibkr.md` — do not guess).
- Handle the documented first-call-may-return-empty case with a re-request.
- Let the existing auth-state handling (gateway unreachable / unauthenticated /
  authenticated) flow through unchanged — never crash on auth loss.

### Mock (`api/app/adapters/mock.py`)

- Honor interval and span to generate a realistic candle count so keyless dev
  renders correctly.

## Frontend wiring

- `web/app/widgets/ChartWidget.tsx`: hold `{ span, interval }` state, render
  `ChartControls`, and key `useResource` on both so changing either triggers a
  refetch. Loading / empty / source-down / unauthenticated / rate-limited states
  reuse `ResourceView` exactly as today. After a fetch, re-sync the highlighted
  buttons from the echoed `interval`/`span` in the response.
- `web/app/lib/loaders.ts`: `loadChartData(symbol, interval, span)` threads the
  params; `loadChart` / `loadCrypto` pass them as typed query params.
- `web/app/components/ChartControls.tsx`: new presentational component (two
  button rows, disabled state for invalid intervals).
- `web/app/components/CandleChart.tsx`: unchanged — renders whatever candles it
  receives and `fitContent()`s.
- `resolveRange` lives in a small lib module (e.g. `web/app/lib/chart/range.ts`)
  so it is unit-testable in isolation, matching the existing "pure, tested
  functions" pattern used for the command parser / symbol router.

## Error & edge handling

- All failure modes route through the existing `ResourceView` envelope states —
  no new bespoke error UI.
- Invalid query param → 422 → error state.
- IBKR unauthenticated / gateway-down → existing IBKR status surfaced as today.
- Empty candle set → existing "No candles." state.

## Testing

Backend:
- `Interval`/`Span` enum validation → 422 on bad input.
- Kraken `since` computation from span.
- IBKR `/iserver/marketdata/history` request construction + `data[]` → `Candle`
  normalization (mocked httpx).

Frontend:
- `resolveRange` pure-function tests: span auto-snap default, valid-set
  membership, cap never exceeded.
- `ChartControls` interaction test: clicking a span snaps interval; invalid
  intervals are disabled.

## Files touched (estimate)

- `api/app/models.py` — `Interval`, `Span` enums; response fields.
- `api/app/routers.py` — query params on `/chart` and `/crypto`.
- `api/app/adapters/base.py` — signature.
- `api/app/adapters/kraken.py` — span→since.
- `api/app/adapters/ibkr.py` — implement history.
- `api/app/adapters/mock.py` — honor interval/span.
- `web/app/widgets/ChartWidget.tsx` — state + controls.
- `web/app/components/ChartControls.tsx` — new.
- `web/app/lib/chart/range.ts` — new (`resolveRange`).
- `web/app/lib/loaders.ts` — thread params.
- Regenerated OpenAPI TS client.
- Tests (backend + frontend) as above.
