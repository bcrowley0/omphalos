# Watchlist widget completeness — design

**Date:** 2026-06-02
**Status:** Approved (brainstorming), pending implementation plan

## Goal

Make the Watchlist widget self-sufficient and complete. Today the widget can only
be opened by running `watch <SYMBOL>` (a symbol is mandatory), and the only
in-widget management is a per-row ✕ remove button. This adds: opening the widget
empty, an in-widget add box, row reordering, and explicit per-row quote/chart
actions — so the watchlist can be fully managed from inside the widget.

## Scope

In scope (all four agreed with the user):

1. **Open the widget without a symbol.**
2. **In-widget add box** to add symbols without the command bar.
3. **Reorder rows** (up/down), persisted.
4. **Per-row quote/chart actions.**

Out of scope: drag-to-reorder (use up/down buttons), new backend endpoints,
streaming/websockets, server persistence. All watchlist state stays in
`localStorage` via the existing terminal store.

## Current state (reference)

- Widget: `web/app/widgets/WatchlistWidget.tsx` — renders a table of quotes; each
  row's symbol is a button dispatching `chart <SYMBOL>`; a ✕ button dispatches
  `unwatch <SYMBOL>`. Empty case shows a hint only.
- Grammar: `web/app/lib/command/parser.ts` — `watch`/`unwatch` require an argument
  (`watch` with no args returns a usage error).
- Command → tab mapping: `web/app/lib/command/tabs.ts`.
- Store: `web/app/lib/store.ts` — `dispatch(input)` parses a command, mutates the
  `watchlist: string[]` (dedupe on add, filter on remove), opens/focuses tabs, and
  persists `{ tabs, activeId, watchlist, following }` to `localStorage` key
  `omphalos.terminal.v1`.
- Loader: `web/app/lib/loaders.ts` — `loadWatchlist(symbols)` fetches a quote per
  symbol in parallel; returns quotes in input order (nulls filtered).
- Command-bar suggestions: in `web/app/components/CommandBar.tsx`.

## Design

### 1. Open the widget empty

- **Parser:** `watch` with **no argument** returns `{ kind: "watchlist" }` instead
  of a usage error. A dedicated `watchlist` verb also returns `{ kind: "watchlist" }`.
  `watch <SYMBOL>` is unchanged (`{ kind: "watch", symbol }`). `unwatch <SYMBOL>`
  unchanged. The command discriminated-union type gains the `watchlist` variant.
- **tabs.ts:** maps `{ kind: "watchlist" }` to the existing `watchlist` tab
  (id `watchlist`, same tab `watch`/`unwatch` already open).
- **store.ts:** on `kind === "watchlist"`, open/focus the watchlist tab and mutate
  nothing else.
- **CommandBar suggestions:** add a `watchlist` entry; update the `watch` hint to
  "open / add to watchlist" and mark it as not requiring an argument.

### 2. In-widget add box

- A compact row at the top of the widget: a text input + an **Add** button.
  Submitting (button click or Enter) dispatches `watch <SYMBOL>` with the trimmed,
  uppercased value, then clears the input. Empty/whitespace input is a no-op.
- Reuses the existing store dedupe path — no new validation logic. Symbol routing
  (IBKR vs Kraken) continues to happen downstream exactly as it does for a
  command-bar `watch`.
- The same add box is featured in the empty state (instead of the current
  hint-only dead end), with the existing `watch <SYMBOL>` hint kept as helper text.

### 3. Reorder rows

- Per-row **▲ / ▼** buttons. New store method
  `moveWatchlistSymbol(symbol: string, dir: "up" | "down")` reorders the
  `watchlist` array and persists. Moving the first item up / last item down is a
  no-op (clamped at the ends).
- **No refetch on reorder.** The loader key becomes **order-independent** (sorted
  symbols), so reordering does not change the resource key and does not trigger a
  fetch. The widget renders rows in `watchlist` (display) order by looking up each
  loaded quote by symbol. Add/remove still change the set and refetch as today.

### 4. Per-row quote/chart actions

- A compact action cell per row with: a **chart** button (dispatch
  `chart <SYMBOL>`), a **quote** button (dispatch `quote <SYMBOL>`), and the
  existing **✕** remove (dispatch `unwatch <SYMBOL>`). The symbol text stays
  click-to-chart for muscle memory.

### Error/empty/loading states

Unchanged rails: the widget keeps using `WidgetFrame` + `ResourceView`. Loading,
source-down, rate-limited, unauthenticated, and stale handling all flow through the
existing per-quote loader and shared UI components. The only empty-state change is
showing the add box instead of a hint-only message.

## Data flow (after)

1. `watch` / `watchlist` (no symbol) → parser `{ kind: "watchlist" }` → store opens
   the watchlist tab, no mutation.
2. In-widget Add → `terminalStore.dispatch("watch <SYMBOL>")` → existing add path.
3. ▲/▼ → `terminalStore.moveWatchlistSymbol(symbol, dir)` → reorder + persist; no
   refetch (order-independent load key); rows re-render in new order.
4. Per-row chart/quote/✕ → dispatch `chart`/`quote`/`unwatch <SYMBOL>`.

## Testing

- **parser.test.ts:** `watch` (no arg) → `{ kind: "watchlist" }`; `watchlist` →
  `{ kind: "watchlist" }`; `watch nvda` → `{ kind: "watch", symbol: "NVDA" }`
  (regression); `unwatch` regression.
- **tabs.ts test:** `{ kind: "watchlist" }` maps to the `watchlist` tab.
- **store.test.ts:** `watchlist` / bare `watch` opens/focuses the watchlist tab
  without mutating the list; `moveWatchlistSymbol` moves up and down and is a no-op
  at the ends; existing dedupe/remove/persist tests still pass.
- **Widget:** changes verified by `npm test` (full suite green) plus a manual run of
  the app to exercise the add box, reorder, and per-row actions.

## Files touched

- `web/app/lib/command/parser.ts` (+ `parser.test.ts`)
- `web/app/lib/command/tabs.ts` (+ test)
- `web/app/lib/store.ts` (+ `store.test.ts`)
- `web/app/widgets/WatchlistWidget.tsx`
- `web/app/components/CommandBar.tsx` (suggestions)
- The command discriminated-union type (wherever `Command` is declared)
- `web/app/lib/loaders.ts` only if the order-independent load key is implemented in
  the loader rather than the widget (decision deferred to the plan; default: make
  the load key sorted at the widget call site, leaving the loader untouched).
