# Per-Widget Settings Menu — Design

**Date:** 2026-05-31
**Status:** Approved for planning

## Problem

Widget headers and toolbars expose every control inline. The News widget, for
example, renders its feed source selector and add-feed form (`FeedBar`) full-width
above the content, crowding the headline list. Non-essential controls should move
into a per-widget settings menu (a gear icon in the header), keeping the widget
surface focused on its primary content.

## Goals

- Every widget that has configurable options gets a gear (⚙) button in its header
  that opens a popover containing its non-essential controls.
- Generalize the existing one-off `YieldWidget` `SettingsPopover` into a single
  shared component reused by all widgets.
- Persist per-widget settings to `localStorage` so they survive reloads.
- Add an opt-in auto-refresh interval per data widget.

## Non-goals

- No websockets/streaming (still prohibited). Auto-refresh is client-side polling
  of the existing snapshot endpoints only.
- No settings on widgets with nothing meaningful to configure (Help; Calendar stub).
- No declarative/config-driven settings framework (YAGNI for ~8 widgets).

## CLAUDE.md rule change (flagged conflict)

Auto-refresh conflicts with hard rule #5 ("Snapshot / on-demand only. No websockets
or streaming. Data loads on widget open and on an explicit refresh."). The user
chose to add opt-in auto-refresh. To keep the codebase rules honest, **hard rule #5
in `CLAUDE.md` will be amended** to carve out:

> Opt-in, client-side polling that re-fetches the existing snapshot endpoint on a
> user-selected interval is permitted (off by default). Still no websockets or
> server-push streaming.

This edit is part of the implementation.

## Chosen approach

**Shared `WidgetSettingsMenu` component + generic prefs/auto-refresh hooks.**

Rejected alternatives:
- *Per-widget bespoke popovers* — 8× duplicated popover + persistence code that drifts.
- *Config-driven settings registry* — over-engineered for the current widget count.

## Components

### `WidgetSettingsMenu` (new — `web/app/components/`)
- Gear (⚙) button + absolutely-positioned popover, generalized from
  `YieldWidget`'s `SettingsPopover` (open/close state, click-outside-to-close,
  right-aligned `top: calc(100% + 0.4rem)` positioning, shadow/border styling).
- Props: `children` (the settings content). Optional `label` for the button title.
- Rendered through `WidgetFrame`'s **existing** `headerExtra` slot — no change to
  `WidgetFrame`'s public API.

### `useWidgetPrefs<T>(key, defaults, validate)` (new hook)
- Returns `[prefs, setPrefs]`. Loads from `localStorage` with shape validation and
  default fallback (the existing `yieldPrefs.ts` safety pattern), saves on every
  change inside try/catch.
- Key convention: `omphalos.<widget>.prefs.v1`.
- `yieldPrefs.ts` is refactored to sit on top of this hook (fold the bespoke
  load/validate/save into the shared implementation).

### `useAutoRefresh(refresh, intervalMs)` (new hook)
- `setInterval(refresh, intervalMs)` when `intervalMs > 0`; cleared on unmount and
  whenever the interval changes or is disabled. `0`/off means no polling.

## Per-widget settings content

| Widget | Settings menu contents |
|---|---|
| News | Feed source filter + add-feed form (moved out of inline `FeedBar`); auto-refresh |
| Chart | Auto-refresh; show/hide "via source". Span/interval stay **inline** (primary interaction) |
| Quote | Show/hide source & stale badge; auto-refresh |
| Portfolio | Toggle IBKR positions / Kraken balances sections; auto-refresh |
| Watchlist | Show/hide columns (bid, ask, change, %); auto-refresh |
| Following | Curated/all toggle (moved into menu); auto-refresh |
| Yield | Existing series toggles + as-of date (moved into shared gear); auto-refresh |
| Calendar (stub), Help | No gear |

### Auto-refresh options
Off (default) / 30s / 1m / 5m, per widget, persisted. Reuses each widget's existing
loading/error/stale UI; no new endpoints.

## Persistence

Each widget defines a typed prefs object (e.g.
`{ autoRefreshMs: number; showSource: boolean; ... }`) stored under
`omphalos.<widget>.prefs.v1`, loaded with validation + default fallback, saved on
every change. Corrupt data silently falls back to defaults.

## Error handling / states

No new external calls. Auto-refresh polling reuses existing per-widget loading,
source-down, unauthenticated, rate-limited, and empty states. Corrupt localStorage
→ defaults.

## Testing

- `useWidgetPrefs`: load/validate/save round-trip; corrupt-data fallback.
- `useAutoRefresh`: fires at the configured interval; clears on unmount and on
  disable (fake timers).
- `WidgetSettingsMenu`: opens/closes; closes on click-outside.
- News: feed filter + add-feed continue to work from inside the menu.
- Each widget's new toggles flip the expected UI and persist.

## Out-of-scope follow-ups

- Drag-to-reorder or grouping of settings.
- Syncing settings to a backend (still localStorage-only per stack rules).
