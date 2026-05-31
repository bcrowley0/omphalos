# Widget auto-refresh — design

**Date:** 2026-05-31
**Status:** Approved (pending spec review)

## Goal

Let the user opt an individual widget into **bounded automatic refresh** so they
don't have to keep pressing refresh on data that moves. A per-widget **"auto"
toggle** (off by default) on the four live-data widgets — **quote, watchlist,
portfolio, chart** — makes that widget silently re-fetch on a fixed,
per-widget-type interval. When off, the widget is manual-only exactly as today.

Note: there is no separate "crypto" widget — the `crypto` verb is retired and
crypto pairs are opened via the **`chart`** command (Kraken routing is decided
server-side). So crypto price coverage is the chart widget.

This is a narrow, **documented relaxation** of `CLAUDE.md` rule 5. It stays
within the spirit of "snapshot / on-demand": each refresh is still a discrete
snapshot read, just self-triggered on a bounded cadence the user explicitly
opted into. **No websockets, no streaming, no continuous polling of a source
faster than its cache TTL.**

## Non-goals (YAGNI)

- No websockets / streaming (still forbidden by rule 5).
- No global on/off setting and no app-wide "live mode."
- No user-editable intervals and no per-source interval UI — intervals are fixed
  per widget type.
- No auto-refresh on slow/static widgets (news, yield, calendar, help, settings).
- No backend changes. The adapter contract, cache, and envelope shapes are
  untouched. This is a frontend-only feature.

## Rule 5 amendment

`CLAUDE.md` rule 5 currently reads:

> Snapshot / on-demand only. No websockets or streaming. Data loads on widget
> open and on an explicit refresh.

It will be reworded to permit this feature explicitly, so the behavior is not a
silent conflict:

> Default is snapshot / on-demand: data loads on widget open and on an explicit
> refresh. A widget may additionally be **opted into bounded auto-refresh** via
> an off-by-default per-widget toggle, with a **fixed interval ≥ the source's
> cache TTL**, **paused when the tab is hidden**, and **auto-disabled on
> source-down / rate-limited / unauthenticated / transport errors**. Still no
> websockets or streaming, and no refresh faster than the per-source cache TTL.

## Eligibility and intervals

Only the four live-data widgets get the toggle. Each has a fixed interval chosen
to be **≥ the backing source's cache TTL**, so the timer can never out-pace the
cache (the provider is hit at most once per TTL regardless of interval).

| Widget    | Interval | Rationale / backing TTL                          |
|-----------|----------|--------------------------------------------------|
| quote     | 15s      | Kraken ticker TTL 15s; IBKR snapshot uncached    |
| watchlist | 30s      | multi-symbol, heavier; mixed sources             |
| portfolio | 30s      | IBKR positions + Kraken balances; auth-sensitive |
| chart     | 30s      | Kraken OHLC TTL 30s; IBKR candles uncached        |

News (60s TTL), yield (60s), calendar, help, and settings show **no toggle**.

The chart's auto-refresh re-runs its existing `load`, which is already keyed on
the current span/interval, so a background refresh re-fetches **the current
window** — no special chart logic. On long spans the refetched data is usually
identical and served from cache; harmless.

Confirmed backend TTLs (for reference): `kraken._TICKER_TTL = 15`,
`kraken._OHLC_TTL = 30`, `fred._HISTORY_TTL = 60`, `rss._FEED_TTL = 60`. IBKR
market-data snapshots are currently uncached (live re-request).

## Components

### `useResource.ts` — the only real logic change

The shared hook gains an optional options arg:

```ts
useResource<T>(load, { autoRefreshMs?: number; enabled?: boolean })
```

Two **distinct** refresh paths:

- **`refresh()`** (manual) — unchanged: sets state to `loading`, then refetches.
  Manual refresh keeps the full loading state (a deliberate, user-initiated act).
- **`backgroundRefresh()`** (new) — keeps the current data on screen and swaps in
  the new snapshot when it arrives. **No `loading` flash.** Used by the timer.

State changes:

- Add an `isRefreshing: boolean` flag to the `ok` state (or alongside it) so the
  widget can render a tiny "updating…" indicator during a background refresh
  without blanking.
- The existing `ResourceState` discriminated union is otherwise preserved.

Timer behavior, all inside the hook:

- A `setInterval(backgroundRefresh, autoRefreshMs)` runs **only while `enabled`
  is true AND the document is visible**.
- The interval is cleared on: `enabled → false`, unmount, and tab hidden.
- On `visibilitychange`: suspend the interval when `hidden`, resume (and fire one
  immediate `backgroundRefresh`) when visible again.
- **Auto-disable on bad state:** when a `backgroundRefresh` resolves to an
  envelope whose `status` is source-down / rate-limited / unauthenticated, or to
  a `transport_error`, the hook stops the timer and signals the widget to revert
  the toggle to **off** (via an `onAutoDisabled(reason)` callback the widget
  passes in). The widget surfaces a short note ("auto-refresh paused — source
  unavailable") and the user re-enables manually once healthy.

### `autoRefresh.ts` — interval map (new, pure, unit-tested)

A tiny module exporting the fixed per-widget-type intervals (the table above) as
a typed map, plus a helper `autoRefreshMsFor(widgetType)`. Pure and unit-tested
so the intervals are a single source of truth, not scattered literals.

### Toggle UI

A small **"auto" toggle** rendered next to each eligible widget's existing
refresh control (in the shared widget chrome — `ui.tsx` / `WidgetHost.tsx`,
following the existing refresh-button placement). Off by default. Shows the
"updating…" indicator while a background refresh is in flight, and a paused note
when auto-disabled.

### Toggle persistence

The toggle is **non-secret UI state**, so per `CLAUDE.md` it lives in
`localStorage`, keyed per widget tab, alongside the existing watchlist/open-tabs
state in `store.ts`. Survives reload; defaults off. (If a tab's source is
unhealthy on load, the toggle still starts from its persisted value and
auto-disables on the first bad fetch — we do not try to persist a "was
auto-disabled" reason.)

## Data flow

1. Widget opens → `useResource` fires the initial snapshot fetch (unchanged).
2. User flips the **auto** toggle on → widget persists `true` to `localStorage`
   and passes `enabled: true` + `autoRefreshMs` to `useResource`.
3. Hook starts the interval (only while visible). Each tick calls
   `backgroundRefresh()`, which fetches and swaps data in with no loading flash.
4. Tab hidden → interval suspends. Tab visible again → one immediate refresh,
   then the interval resumes.
5. A background fetch returns a bad status / transport error → hook stops the
   timer and calls `onAutoDisabled`; widget reverts the toggle to off, persists
   `false`, shows the paused note.
6. User flips auto off, or closes the widget → interval cleared.

## Error handling

- **Manual refresh** keeps the existing behavior (loading state → data/error).
- **Background refresh** never blanks the widget; on a bad fetch it triggers
  auto-disable (above) rather than replacing good data with an error screen. The
  last good snapshot stays visible with the paused note.
- The rule-6 visible states (loading, source-down, unauthenticated,
  rate-limited, empty) are unchanged for the initial fetch and manual refresh.

## Testing

Frontend only (vitest), no backend changes:

- **`useResource` unit tests** (fake timers + mocked `document.visibilityState`):
  - the interval calls `backgroundRefresh`, not `refresh` (no loading flash);
  - timer pauses when hidden and resumes (with an immediate refresh) when visible;
  - interval is cleared on unmount and on `enabled → false`;
  - a bad-status / transport-error envelope triggers `onAutoDisabled` and stops
    the timer;
  - `isRefreshing` is true during a background fetch and false after.
- **`autoRefresh.ts` unit tests:** `autoRefreshMsFor` returns the expected fixed
  interval per widget type, and the eligible set is exactly
  {quote, watchlist, portfolio, chart}.
- **Toggle persistence:** flipping the toggle writes/reads the per-tab key in
  `store.ts` (extend existing store tests).

## Files touched (anticipated)

- `web/app/lib/useResource.ts` — options arg, `backgroundRefresh`, timer,
  visibility + auto-disable logic, `isRefreshing`.
- `web/app/lib/autoRefresh.ts` — **new** interval map + helper (+ test).
- `web/app/lib/store.ts` — per-tab auto-toggle persistence (+ test).
- `web/app/components/ui.tsx` / `WidgetHost.tsx` — the toggle + indicators.
- `web/app/widgets/{Quote,Watchlist,Portfolio,Chart}Widget.tsx` — pass
  `enabled` / `autoRefreshMs` / `onAutoDisabled` into `useResource`.
- `CLAUDE.md` — rule 5 reword.
