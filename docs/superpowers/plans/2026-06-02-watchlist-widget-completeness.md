# Watchlist Widget Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Watchlist widget self-sufficient — open it without a symbol, add/remove/reorder symbols from inside the widget, and jump to chart/quote per row.

**Architecture:** Extend the pure command grammar with a `watchlist` intent (bare `watch` and `watchlist` both open the tab without mutating). Add a `moveWatchlistSymbol` method to the terminal store for reordering. Rebuild the widget body to render an add box, ordered rows (by the store's `watchlist` order, looked up by symbol so reorder needs no refetch), and per-row chart/quote/remove/▲/▼ actions.

**Tech Stack:** Next.js (App Router) + TypeScript + React, vitest for unit tests. All state is the existing `localStorage`-backed `TerminalStore`. No backend changes.

---

## Background: how the pieces fit (read once before starting)

- `web/app/lib/command/types.ts` — the `Command` discriminated union and `Tab`/`WidgetKind` types.
- `web/app/lib/command/parser.ts` — pure `parseCommand(input): Command`. `watch`/`unwatch` currently *require* an argument (return a usage error otherwise).
- `web/app/lib/command/tabs.ts` — pure `commandToTab(cmd): Tab | null`. `watch`/`unwatch` already map to the singleton `watchlist` tab.
- `web/app/lib/store.ts` — `TerminalStore`. `dispatch(input)` parses, mutates `watchlist: string[]` (dedupe on `watch`, filter on `unwatch`), opens/focuses tabs, persists. Exposes `subscribe`/`getSnapshot` for `useSyncExternalStore`; a singleton `terminalStore` is exported.
- `web/app/widgets/WatchlistWidget.tsx` — renders the table. Load key is `watchlist.join(",")` (order-sensitive today).
- `web/app/components/CommandBar.tsx` — `SUGGESTIONS` array drives the focus menu.

**Run the full test suite with:** `cd web && npm test`
**Run one test file with:** `cd web && npx vitest run app/lib/command/parser.test.ts`

All commands in this plan assume you are in the repo root: `/home/brian/omphalos/.claude/worktrees/6`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `web/app/lib/command/types.ts` | Command union | Add `{ kind: "watchlist" }` variant |
| `web/app/lib/command/parser.ts` | Parse grammar | Bare `watch` and `watchlist` → `{ kind: "watchlist" }` |
| `web/app/lib/command/tabs.ts` | Command→Tab | Map `watchlist` to the singleton watchlist tab |
| `web/app/lib/store.ts` | Terminal state | `watchlist` kind opens tab w/o mutation; add `moveWatchlistSymbol` |
| `web/app/widgets/WatchlistWidget.tsx` | Widget UI | Add box, ordered rows, per-row chart/quote/✕/▲/▼, order-independent load key |
| `web/app/components/CommandBar.tsx` | Suggestion menu | Add `watchlist` entry; update `watch` hint |
| `*.test.ts` (parser, tabs, store) | Unit tests | New cases for the above |

---

## Task 1: Add the `watchlist` command variant to the type union

**Files:**
- Modify: `web/app/lib/command/types.ts:3-17`

- [ ] **Step 1: Add the variant to the `Command` union**

In `web/app/lib/command/types.ts`, add a `watchlist` member right after the `unwatch` line so the union reads:

```typescript
export type Command =
  | { kind: "chart"; symbol: string }
  | { kind: "quote"; symbol: string }
  | { kind: "watch"; symbol: string }
  | { kind: "unwatch"; symbol: string }
  | { kind: "watchlist" }
  | { kind: "port" }
  | { kind: "yield" }
  | { kind: "news"; feed?: string }
  | { kind: "cal" }
  | { kind: "help" }
  | { kind: "follow"; name: string }
  | { kind: "unfollow"; name: string }
  | { kind: "following" }
  | { kind: "settings" }
  | { kind: "error"; input: string; message: string };
```

- [ ] **Step 2: Verify the project still type-checks / tests still pass**

Run: `cd web && npm test`
Expected: PASS (all current tests). The new union member is not yet produced or consumed, so nothing breaks. (`commandToTab`'s switch is exhaustive but has no `default`, so TypeScript may now warn that `watchlist` is unhandled — that is fixed in Task 3. If `npm test` surfaces a type error here, that is expected and resolved by Task 3; proceed.)

- [ ] **Step 3: Commit**

```bash
git add web/app/lib/command/types.ts
git commit -m "feat(web): add watchlist command variant to type union"
```

---

## Task 2: Parse bare `watch` and `watchlist` into the `watchlist` intent

**Files:**
- Modify: `web/app/lib/command/parser.ts:19-26`
- Test: `web/app/lib/command/parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the `describe("parseCommand", ...)` block in `web/app/lib/command/parser.test.ts` (e.g. right after the existing `watch NVDA` test at line 16):

```typescript
it("parses bare `watch` (no symbol) as opening the watchlist", () => {
  expect(parseCommand("watch")).toEqual({ kind: "watchlist" });
});

it("parses the `watchlist` verb as opening the watchlist", () => {
  expect(parseCommand("watchlist")).toEqual({ kind: "watchlist" });
});

it("still parses `watch <SYMBOL>` as adding to the watchlist", () => {
  expect(parseCommand("watch tsla")).toEqual({ kind: "watch", symbol: "TSLA" });
});

it("still errors on bare `unwatch` (a symbol is required to remove)", () => {
  expect(parseCommand("unwatch").kind).toBe("error");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/lib/command/parser.test.ts`
Expected: FAIL — bare `watch` currently returns an `error` command, and `watchlist` is an unknown verb.

- [ ] **Step 3: Implement the parser change**

In `web/app/lib/command/parser.ts`, split `watch` out of the shared symbol-requiring case and add a `watchlist` verb. Replace the block at lines 20-26:

```typescript
    case "chart":
    case "quote":
    case "watch":
    case "unwatch": {
      if (args.length === 0) return err(input, `Usage: ${verb} <SYMBOL>`);
      return { kind: verb, symbol: args[0].toUpperCase() };
    }
```

with:

```typescript
    case "chart":
    case "quote":
    case "unwatch": {
      if (args.length === 0) return err(input, `Usage: ${verb} <SYMBOL>`);
      return { kind: verb, symbol: args[0].toUpperCase() };
    }
    case "watchlist":
      return { kind: "watchlist" };
    case "watch":
      // Bare `watch` opens the (possibly empty) watchlist; with a symbol it adds.
      return args.length === 0 ? { kind: "watchlist" } : { kind: "watch", symbol: args[0].toUpperCase() };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/lib/command/parser.test.ts`
Expected: PASS (new cases plus all existing parser cases).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/command/parser.ts web/app/lib/command/parser.test.ts
git commit -m "feat(web): bare watch and watchlist verb open the watchlist"
```

---

## Task 3: Map the `watchlist` command to the watchlist tab

**Files:**
- Modify: `web/app/lib/command/tabs.ts:14-16`
- Test: `web/app/lib/command/tabs.test.ts`

- [ ] **Step 1: Write the failing test**

Add this case inside `describe("commandToTab", ...)` in `web/app/lib/command/tabs.test.ts` (e.g. after the existing watch/unwatch test at line 30):

```typescript
it("maps the bare `watch`/`watchlist` intent to the single watchlist tab", () => {
  expect(tabFor("watch")).toMatchObject({ id: "watchlist", widget: "watchlist" });
  expect(tabFor("watchlist")).toMatchObject({ id: "watchlist", widget: "watchlist" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run app/lib/command/tabs.test.ts`
Expected: FAIL — `commandToTab` has no `watchlist` case (and TypeScript flags the switch as non-exhaustive).

- [ ] **Step 3: Implement the mapping**

In `web/app/lib/command/tabs.ts`, add `watchlist` to the watchlist-tab case. Replace lines 14-16:

```typescript
    case "watch":
    case "unwatch":
      return { id: "watchlist", widget: "watchlist", title: "Watchlist" };
```

with:

```typescript
    case "watch":
    case "unwatch":
    case "watchlist":
      return { id: "watchlist", widget: "watchlist", title: "Watchlist" };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run app/lib/command/tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/command/tabs.ts web/app/lib/command/tabs.test.ts
git commit -m "feat(web): map watchlist command to the watchlist tab"
```

---

## Task 4: Store opens the watchlist without mutating; add `moveWatchlistSymbol`

**Files:**
- Modify: `web/app/lib/store.ts:105-110` (dispatch) and add a method near line 161
- Test: `web/app/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside `describe("TerminalStore", ...)` in `web/app/lib/store.test.ts` (e.g. after the existing watch/unwatch test at line 37):

```typescript
it("bare watch / watchlist opens the watchlist tab without changing the list", () => {
  const s = new TerminalStore();
  s.dispatch("watch NVDA");
  s.dispatch("watch AAPL");
  s.dispatch("watch"); // bare: open only
  expect(s.getSnapshot().watchlist).toEqual(["NVDA", "AAPL"]);
  expect(s.getSnapshot().activeId).toBe("watchlist");
  s.dispatch("watchlist"); // verb form: also open only
  expect(s.getSnapshot().watchlist).toEqual(["NVDA", "AAPL"]);
});

it("moveWatchlistSymbol reorders up and down and persists", () => {
  const s = new TerminalStore();
  s.dispatch("watch A");
  s.dispatch("watch B");
  s.dispatch("watch C");
  s.moveWatchlistSymbol("C", "up");
  expect(s.getSnapshot().watchlist).toEqual(["A", "C", "B"]);
  s.moveWatchlistSymbol("A", "down");
  expect(s.getSnapshot().watchlist).toEqual(["C", "A", "B"]);

  const afterRefresh = new TerminalStore();
  expect(afterRefresh.getSnapshot().watchlist).toEqual(["C", "A", "B"]);
});

it("moveWatchlistSymbol is a no-op at the ends and for unknown symbols", () => {
  const s = new TerminalStore();
  s.dispatch("watch A");
  s.dispatch("watch B");
  s.moveWatchlistSymbol("A", "up"); // already first
  s.moveWatchlistSymbol("B", "down"); // already last
  s.moveWatchlistSymbol("Z", "up"); // not present
  expect(s.getSnapshot().watchlist).toEqual(["A", "B"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/lib/store.test.ts`
Expected: FAIL — `moveWatchlistSymbol` does not exist; bare `watch` may currently behave differently.

- [ ] **Step 3: Verify dispatch already handles the `watchlist` kind**

No code change is needed in `dispatch` for the "open without mutating" behavior: the `if (cmd.kind === "watch")` branch at `web/app/lib/store.ts:106` does not match `kind === "watchlist"`, so the list is untouched, and `commandToTab` (Task 3) returns the watchlist tab which the existing tab-opening block activates. Confirm by reading lines 105-128; do not edit them.

- [ ] **Step 4: Implement `moveWatchlistSymbol`**

In `web/app/lib/store.ts`, add this method to the `TerminalStore` class (e.g. immediately after the `unfollowPerson` method around line 161):

```typescript
  /** Move a watched symbol one position up or down. No-op at the ends / unknown symbol. */
  moveWatchlistSymbol(symbol: string, dir: "up" | "down") {
    const list = this.state.watchlist;
    const i = list.indexOf(symbol);
    if (i === -1) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    this.set({ ...this.state, watchlist: next });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/lib/store.test.ts`
Expected: PASS (new cases plus all existing store cases).

- [ ] **Step 6: Commit**

```bash
git add web/app/lib/store.ts web/app/lib/store.test.ts
git commit -m "feat(web): watchlist opens without mutating; add moveWatchlistSymbol"
```

---

## Task 5: Add the `watchlist` suggestion and update `watch` hint in the command bar

**Files:**
- Modify: `web/app/components/CommandBar.tsx:10-22`

This is a presentational list with no unit test harness; verification is by build + the manual run in Task 7.

- [ ] **Step 1: Update the `SUGGESTIONS` array**

In `web/app/components/CommandBar.tsx`, change the `watch` entry (line 19) and add a `watchlist` entry. Replace line 19:

```typescript
  { verb: "watch", label: "watch <SYMBOL>", hint: "add to watchlist", needsArg: true },
```

with:

```typescript
  { verb: "watchlist", label: "watchlist", hint: "open the watchlist", needsArg: false },
  { verb: "watch", label: "watch <SYMBOL>", hint: "add to watchlist (bare: open it)", needsArg: true },
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add web/app/components/CommandBar.tsx
git commit -m "feat(web): surface watchlist in command-bar suggestions"
```

---

## Task 6: Rebuild the widget body — add box, ordered rows, per-row actions, order-independent load key

**Files:**
- Modify: `web/app/widgets/WatchlistWidget.tsx` (whole component body)

The widget renders the table by mapping over the store's `watchlist` (display order) and looking up each symbol's loaded quote, so reordering does not change the load key and does not refetch. The load key is the sorted symbol set.

- [ ] **Step 1: Replace the component file**

Overwrite `web/app/widgets/WatchlistWidget.tsx` with:

```tsx
"use client";

import { useCallback, useState } from "react";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { ToggleRow } from "../components/WidgetSettingsMenu";
import { loadWatchlist } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { coerceWatchlistPrefs, DEFAULT_WATCHLIST_PREFS, WATCHLIST_PREFS_KEY } from "../lib/widgetSettings";
import type { Schemas } from "../lib/api/client";

const th: React.CSSProperties = { color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const num: React.CSSProperties = { textAlign: "right", padding: "0.3rem 0.6rem" };
const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  padding: "0 0.2rem",
  fontFamily: "inherit",
};

// Small input + Add button. Submitting dispatches `watch <SYMBOL>` (reusing the
// store's dedupe path); Enter submits; empty/whitespace is a no-op.
function AddSymbol() {
  const [value, setValue] = useState("");
  const add = () => {
    const sym = value.trim().toUpperCase();
    if (!sym) return;
    terminalStore.dispatch(`watch ${sym}`);
    setValue("");
  };
  return (
    <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem" }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="add symbol — AAPL or BTC/USD"
        spellCheck={false}
        autoComplete="off"
        aria-label="add symbol to watchlist"
        style={{
          flex: 1,
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--foreground)",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          padding: "0.3rem 0.5rem",
          outline: "none",
        }}
      />
      <button
        onClick={add}
        style={{
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--accent)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          padding: "0.3rem 0.8rem",
        }}
      >
        Add
      </button>
    </div>
  );
}

export default function WatchlistWidget({ tabId }: { tabId: string }) {
  const { watchlist } = useTerminal();
  // Order-independent load key: reordering the list must NOT trigger a refetch.
  const key = [...watchlist].sort().join(",");
  const [prefs, setPrefs] = useWidgetPrefs(WATCHLIST_PREFS_KEY, DEFAULT_WATCHLIST_PREFS, coerceWatchlistPrefs);
  const load = useCallback(() => loadWatchlist(watchlist), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { on, setOn, pausedReason, onAutoDisabled } = useAutoRefreshToggle(tabId);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("watchlist"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });

  const settings = (
    <WidgetSettingsMenu title="watchlist settings">
      <ToggleRow label="Last" checked={prefs.showLast} onChange={() => setPrefs({ ...prefs, showLast: !prefs.showLast })} />
      <ToggleRow label="Chg %" checked={prefs.showChgPct} onChange={() => setPrefs({ ...prefs, showChgPct: !prefs.showChgPct })} />
      <ToggleRow label="Bid" checked={prefs.showBid} onChange={() => setPrefs({ ...prefs, showBid: !prefs.showBid })} />
      <ToggleRow label="Ask" checked={prefs.showAsk} onChange={() => setPrefs({ ...prefs, showAsk: !prefs.showAsk })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title="Watchlist"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing, paused: pausedReason }}
    >
      <AddSymbol />
      <ResourceView state={state}>
        {(data) => {
          // Render in display (watchlist) order, looking up each quote by symbol.
          const bySymbol = new Map(data.quotes.map((q) => [q.symbol, q]));
          if (watchlist.length === 0) {
            return (
              <p style={{ color: "var(--muted)" }}>
                Watchlist is empty. Add a symbol above, or use <code>watch &lt;SYMBOL&gt;</code>.
              </p>
            );
          }
          return (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                  {prefs.showLast && <th style={{ ...th, textAlign: "right" }}>Last</th>}
                  {prefs.showBid && <th style={{ ...th, textAlign: "right" }}>Bid</th>}
                  {prefs.showAsk && <th style={{ ...th, textAlign: "right" }}>Ask</th>}
                  {prefs.showChgPct && <th style={{ ...th, textAlign: "right" }}>Chg%</th>}
                  <th style={{ padding: "0.3rem 0.6rem" }} />
                </tr>
              </thead>
              <tbody>
                {watchlist.map((symbol, i) => {
                  const q: Schemas["Quote"] | undefined = bySymbol.get(symbol);
                  return (
                    <tr key={symbol} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.3rem 0.6rem" }}>
                        <button
                          onClick={() => terminalStore.dispatch(`chart ${symbol}`)}
                          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                          title="open chart"
                        >
                          {symbol}
                        </button>
                      </td>
                      {prefs.showLast && <td style={num}>{fmt(q?.last)}</td>}
                      {prefs.showBid && <td style={num}>{fmt(q?.bid)}</td>}
                      {prefs.showAsk && <td style={num}>{fmt(q?.ask)}</td>}
                      {prefs.showChgPct && <td style={{ ...num, color: signColor(q?.changePct) }}>{fmt(q?.changePct)}%</td>}
                      <td style={{ ...num, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => terminalStore.moveWatchlistSymbol(symbol, "up")}
                          disabled={i === 0}
                          style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? "default" : "pointer" }}
                          title="move up"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => terminalStore.moveWatchlistSymbol(symbol, "down")}
                          disabled={i === watchlist.length - 1}
                          style={{ ...iconBtn, opacity: i === watchlist.length - 1 ? 0.3 : 1, cursor: i === watchlist.length - 1 ? "default" : "pointer" }}
                          title="move down"
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => terminalStore.dispatch(`quote ${symbol}`)}
                          style={iconBtn}
                          title="open quote"
                        >
                          Q
                        </button>
                        <button
                          onClick={() => terminalStore.dispatch(`chart ${symbol}`)}
                          style={iconBtn}
                          title="open chart"
                        >
                          ⌁
                        </button>
                        <button
                          onClick={() => terminalStore.dispatch(`unwatch ${symbol}`)}
                          style={iconBtn}
                          title="remove from watchlist"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        }}
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Confirm the `Schemas` import path is correct**

Run: `cd web && grep -n "Schemas" app/lib/loaders.ts | head -1`
Expected: `import type { Schemas } from "./api/client";` — i.e. from the widget the path is `../lib/api/client` (already used in the file above). `fmt` and `signColor` in `app/components/ui.tsx` accept `number | null | undefined`, so the `q?.last` lookups are safe when a symbol has no quote yet.

- [ ] **Step 3: Type-check and run the full suite**

Run: `cd web && npx tsc --noEmit && npm test`
Expected: PASS — no type errors; all unit tests green (the widget has no unit test; logic tests from Tasks 2–4 cover the behavior).

- [ ] **Step 4: Commit**

```bash
git add web/app/widgets/WatchlistWidget.tsx
git commit -m "feat(web): in-widget add box, row reordering, and per-row actions"
```

---

## Task 7: Manual verification in the running app

**Files:** none (manual QA).

- [ ] **Step 1: Build to confirm production compile**

Run: `cd web && npm run build`
Expected: build completes with no type or lint errors.

- [ ] **Step 2: Start the dev server**

Run: `cd web && npm run dev`
Then open `http://localhost:3000`.

- [ ] **Step 3: Exercise each new behavior**

Confirm, in order:
1. Type `watchlist` (or bare `watch`) in the command bar → the Watchlist tab opens even with no symbols, showing the add box and the empty-state hint.
2. Type a symbol (e.g. `AAPL`) in the add box and press Enter / click Add → row appears; input clears.
3. Add a second and third symbol; use ▲/▼ to reorder → order changes instantly, with **no loading flash / no refetch** (quotes stay rendered).
4. Click `Q` → a Quote tab opens for that symbol; click `⌁` (or the symbol text) → a Chart tab opens.
5. Click `✕` → the row is removed.
6. Refresh the browser → the watchlist and its order persist.

- [ ] **Step 4: Stop the server and record the result**

Stop dev (Ctrl-C). If all six checks pass, the feature is complete. If any fails, use superpowers:systematic-debugging before patching.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Open-empty → Tasks 2–4; in-widget add → Task 6 (`AddSymbol`); reorder → Tasks 4 + 6 (`moveWatchlistSymbol` + ▲/▼, order-independent key); per-row actions → Task 6 (`Q`/`⌁`/✕). Command-bar discoverability → Task 5.
- **Type consistency:** `moveWatchlistSymbol(symbol, dir: "up" | "down")` is used identically in the store (Task 4) and the widget (Task 6). The `Command` `watchlist` variant added in Task 1 is produced in Task 2 and consumed in Task 3.
- **No refetch on reorder:** guaranteed by the sorted load key (`[...watchlist].sort().join(",")`) — reordering permutes the array but not its sorted form, so `useCallback`'s dep `key` is unchanged.
