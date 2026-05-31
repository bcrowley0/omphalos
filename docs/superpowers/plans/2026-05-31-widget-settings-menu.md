# Per-Widget Settings Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gear (⚙) settings menu to every configurable widget that holds its non-essential controls, generalizing the one-off Yield popover into a shared component, with per-widget settings persisted to localStorage and an opt-in auto-refresh interval.

**Architecture:** Three new shared units — a generic `useWidgetPrefs` localStorage hook, a `useAutoRefresh` polling hook + `AutoRefreshControl` UI, and a `WidgetSettingsMenu` (gear + popover, click-outside) rendered through `WidgetFrame`'s existing `headerExtra` slot. Each widget gets a small typed prefs shape (validated on load) and supplies its own settings JSX. The bespoke Yield `SettingsPopover` is folded onto the shared component.

**Tech Stack:** Next.js (App Router) + TypeScript + React 19, Vitest (node env, pure-function tests only).

---

## Testing approach (read first)

This codebase tests **pure functions only**, in the **node** Vitest environment (`vitest.config.ts` sets `environment: "node"` and `include: ["app/**/*.test.ts"]`). There is no jsdom, no React Testing Library, and no existing component or hook test. `yieldPrefs.test.ts` tests the pure mutators and never touches `loadYieldPrefs`/`saveYieldPrefs` (which need `window`).

Therefore this plan:
- **TDD the pure logic** (`coercePrefs`, `coerceAutoRefreshMs`, each widget's `coerce*Prefs`) with `*.test.ts` files in the node env.
- **Verifies the React glue** (`useWidgetPrefs`, `useAutoRefresh`, `WidgetSettingsMenu`, widget wiring) via `npm run build` (TypeScript catches contract breaks since FE types are generated from the backend) + `npm run lint` + a **manual dev checklist** (Task 13).

This is an intentional refinement of the design's testing section (which mentioned fake-timer/RTL tests); adding a DOM test stack is out of scope and against the established convention. Behavior is unchanged — only the verification method differs.

All commands run from `/home/brian/omphalos/.worktrees/2/web` unless noted.

## File structure

**Create:**
- `web/app/lib/widgetPrefs.ts` — generic `coercePrefs` + `readPrefs`/`writePrefs` + `useWidgetPrefs` hook.
- `web/app/lib/widgetPrefs.test.ts` — tests for `coercePrefs`.
- `web/app/lib/autoRefresh.ts` — `AUTO_REFRESH_OPTIONS`, `coerceAutoRefreshMs`, `useAutoRefresh` hook.
- `web/app/lib/autoRefresh.test.ts` — tests for `coerceAutoRefreshMs`.
- `web/app/lib/widgetSettings.ts` — the six small per-widget prefs shapes (Quote, Portfolio, Watchlist, Chart, News, Following): defaults + coercers.
- `web/app/lib/widgetSettings.test.ts` — tests for the six coercers.
- `web/app/components/WidgetSettingsMenu.tsx` — gear + popover; plus `AutoRefreshControl` and `ToggleRow` UI atoms.

**Modify:**
- `CLAUDE.md` — amend hard rule #5.
- `web/app/widgets/QuoteWidget.tsx`, `PortfolioWidget.tsx`, `WatchlistWidget.tsx`, `ChartWidget.tsx`, `NewsWidget.tsx`, `FollowingWidget.tsx` — adopt settings menu.
- `web/app/lib/yieldPrefs.ts` + `web/app/widgets/YieldWidget.tsx` — fold popover onto shared component, add `autoRefreshMs`, refactor load/save onto `coercePrefs`.

---

### Task 1: Amend CLAUDE.md hard rule #5

**Files:**
- Modify: `CLAUDE.md` (hard rule #5)

- [ ] **Step 1: Edit the rule**

In `/home/brian/omphalos/.worktrees/2/CLAUDE.md`, find rule 5 under "## Hard rules (non-negotiable)":

```
5. Snapshot / on-demand only. No websockets or streaming. Data loads on widget
   open and on an explicit refresh.
```

Replace with:

```
5. Snapshot / on-demand only. No websockets or server-push streaming. Data loads
   on widget open and on an explicit refresh. EXCEPTION: an opt-in, per-widget
   auto-refresh may re-fetch the existing snapshot endpoint on a user-selected
   interval via client-side polling (off by default) — this is still snapshot
   polling, not streaming.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(rules): permit opt-in client-side snapshot polling (rule #5)"
```

---

### Task 2: Generic widget-prefs hook (`widgetPrefs.ts`)

**Files:**
- Create: `web/app/lib/widgetPrefs.ts`
- Test: `web/app/lib/widgetPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/widgetPrefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coercePrefs } from "./widgetPrefs";

describe("coercePrefs", () => {
  const defaults = { a: 1 };
  const coerce = (x: unknown) => ({
    a: typeof (x as { a?: unknown })?.a === "number" ? (x as { a: number }).a : 1,
  });

  it("returns defaults for null (no stored value)", () => {
    expect(coercePrefs(null, defaults, coerce)).toEqual({ a: 1 });
  });

  it("returns defaults for invalid JSON", () => {
    expect(coercePrefs("{not json", defaults, coerce)).toEqual({ a: 1 });
  });

  it("runs coerce on valid JSON", () => {
    expect(coercePrefs('{"a":5}', defaults, coerce)).toEqual({ a: 5 });
  });

  it("coerce fills defaults for missing fields", () => {
    expect(coercePrefs('{"b":9}', defaults, coerce)).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- widgetPrefs`
Expected: FAIL — cannot resolve `./widgetPrefs` / `coercePrefs` not exported.

- [ ] **Step 3: Write the implementation**

Create `web/app/lib/widgetPrefs.ts`:

```ts
"use client";

// Generic localStorage-backed per-widget UI prefs (non-secret UI state, CLAUDE.md).
// Mirrors the appSettings/yieldPrefs pattern: a pure `coerce` validates untrusted
// parsed JSON and fills defaults; load/save are the only impure parts.

import { useCallback, useState } from "react";

// Pure: turn a raw stored string (or null) into a valid prefs object.
export function coercePrefs<T>(
  raw: string | null,
  defaults: T,
  coerce: (parsed: unknown) => T,
): T {
  if (!raw) return defaults;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function readPrefs<T>(key: string, defaults: T, coerce: (parsed: unknown) => T): T {
  if (typeof window === "undefined") return defaults;
  try {
    return coercePrefs(window.localStorage.getItem(key), defaults, coerce);
  } catch {
    return defaults;
  }
}

export function writePrefs<T>(key: string, prefs: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}

// Returns [prefs, setPrefs]; setPrefs updates state AND persists synchronously.
export function useWidgetPrefs<T>(
  key: string,
  defaults: T,
  coerce: (parsed: unknown) => T,
): [T, (next: T) => void] {
  const [prefs, setState] = useState<T>(() => readPrefs(key, defaults, coerce));
  const setPrefs = useCallback(
    (next: T) => {
      setState(next);
      writePrefs(key, next);
    },
    [key],
  );
  return [prefs, setPrefs];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- widgetPrefs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/widgetPrefs.ts web/app/lib/widgetPrefs.test.ts
git commit -m "feat(web): add generic useWidgetPrefs localStorage hook"
```

---

### Task 3: Auto-refresh hook (`autoRefresh.ts`)

**Files:**
- Create: `web/app/lib/autoRefresh.ts`
- Test: `web/app/lib/autoRefresh.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/autoRefresh.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUTO_REFRESH_OPTIONS, coerceAutoRefreshMs } from "./autoRefresh";

describe("coerceAutoRefreshMs", () => {
  it("passes through valid intervals", () => {
    expect(coerceAutoRefreshMs(0)).toBe(0);
    expect(coerceAutoRefreshMs(30000)).toBe(30000);
    expect(coerceAutoRefreshMs(60000)).toBe(60000);
    expect(coerceAutoRefreshMs(300000)).toBe(300000);
  });

  it("defaults invalid values to 0 (off)", () => {
    expect(coerceAutoRefreshMs(1234)).toBe(0);
    expect(coerceAutoRefreshMs("30000")).toBe(0);
    expect(coerceAutoRefreshMs(undefined)).toBe(0);
    expect(coerceAutoRefreshMs(null)).toBe(0);
  });

  it("every option's ms round-trips through the coercer", () => {
    for (const o of AUTO_REFRESH_OPTIONS) {
      expect(coerceAutoRefreshMs(o.ms)).toBe(o.ms);
    }
  });

  it("Off is the first option and equals 0", () => {
    expect(AUTO_REFRESH_OPTIONS[0]).toEqual({ ms: 0, label: "Off" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- autoRefresh`
Expected: FAIL — cannot resolve `./autoRefresh`.

- [ ] **Step 3: Write the implementation**

Create `web/app/lib/autoRefresh.ts`:

```ts
"use client";

// Opt-in client-side snapshot polling (CLAUDE.md rule #5 exception). Off by
// default. The pure parts (options + coerce) are unit-tested; the hook is glue.

import { useEffect } from "react";

export type AutoRefreshMs = 0 | 30000 | 60000 | 300000;

export const AUTO_REFRESH_OPTIONS: { ms: AutoRefreshMs; label: string }[] = [
  { ms: 0, label: "Off" },
  { ms: 30000, label: "30s" },
  { ms: 60000, label: "1m" },
  { ms: 300000, label: "5m" },
];

const VALID_MS: number[] = AUTO_REFRESH_OPTIONS.map((o) => o.ms);

// Coerce an untrusted persisted value to a valid interval (default Off).
export function coerceAutoRefreshMs(x: unknown): AutoRefreshMs {
  return typeof x === "number" && VALID_MS.includes(x) ? (x as AutoRefreshMs) : 0;
}

// Poll `refresh` every `ms` (0 = disabled). Cleared on unmount / when ms changes.
// `refresh` must be stable (useResource returns a memoized refresh).
export function useAutoRefresh(refresh: () => void, ms: AutoRefreshMs): void {
  useEffect(() => {
    if (!ms) return;
    const id = setInterval(refresh, ms);
    return () => clearInterval(id);
  }, [refresh, ms]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- autoRefresh`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/autoRefresh.ts web/app/lib/autoRefresh.test.ts
git commit -m "feat(web): add useAutoRefresh opt-in snapshot polling hook"
```

---

### Task 4: Shared `WidgetSettingsMenu` component + UI atoms

**Files:**
- Create: `web/app/components/WidgetSettingsMenu.tsx`

No unit test (React component; verified by build/lint in later tasks and Task 13).

- [ ] **Step 1: Write the component**

Create `web/app/components/WidgetSettingsMenu.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AUTO_REFRESH_OPTIONS, type AutoRefreshMs } from "../lib/autoRefresh";

// Gear button + popover for per-widget settings. Generalizes the bespoke Yield
// popover: open/close, click-outside-to-close, right-aligned float under header.
// Rendered via WidgetFrame's `headerExtra` slot.
export default function WidgetSettingsMenu({
  label = "⚙",
  title = "widget settings",
  minWidth = 240,
  children,
}: {
  label?: string;
  title?: string;
  minWidth?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        style={{
          background: "transparent",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.3rem 0.7rem",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.4rem)",
            zIndex: 10,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.7rem",
            minWidth,
            boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// A labeled checkbox row for boolean settings.
export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.8rem",
        padding: "0.25rem 0",
        fontSize: "0.85rem",
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  );
}

// The auto-refresh interval selector, shared by every data widget.
export function AutoRefreshControl({
  value,
  onChange,
}: {
  value: AutoRefreshMs;
  onChange: (ms: AutoRefreshMs) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.8rem",
        padding: "0.25rem 0",
        fontSize: "0.85rem",
      }}
    >
      <span>Auto-refresh</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as AutoRefreshMs)}
        style={{
          background: "var(--background)",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.2rem 0.4rem",
          fontFamily: "inherit",
        }}
      >
        {AUTO_REFRESH_OPTIONS.map((o) => (
          <option key={o.ms} value={o.ms}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run lint`
Expected: PASS (no errors in `WidgetSettingsMenu.tsx`).

- [ ] **Step 3: Commit**

```bash
git add web/app/components/WidgetSettingsMenu.tsx
git commit -m "feat(web): add shared WidgetSettingsMenu + AutoRefreshControl/ToggleRow"
```

---

### Task 5: Per-widget prefs shapes (`widgetSettings.ts`)

**Files:**
- Create: `web/app/lib/widgetSettings.ts`
- Test: `web/app/lib/widgetSettings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/widgetSettings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  coerceChartPrefs,
  coerceFollowingPrefs,
  coerceNewsPrefs,
  coercePortfolioPrefs,
  coerceQuotePrefs,
  coerceWatchlistPrefs,
  DEFAULT_CHART_PREFS,
  DEFAULT_FOLLOWING_PREFS,
  DEFAULT_NEWS_PREFS,
  DEFAULT_PORTFOLIO_PREFS,
  DEFAULT_QUOTE_PREFS,
  DEFAULT_WATCHLIST_PREFS,
} from "./widgetSettings";

describe("widgetSettings coercers", () => {
  it("return defaults for empty / non-object input", () => {
    expect(coerceQuotePrefs(null)).toEqual(DEFAULT_QUOTE_PREFS);
    expect(coercePortfolioPrefs("x")).toEqual(DEFAULT_PORTFOLIO_PREFS);
    expect(coerceWatchlistPrefs(42)).toEqual(DEFAULT_WATCHLIST_PREFS);
    expect(coerceChartPrefs(undefined)).toEqual(DEFAULT_CHART_PREFS);
    expect(coerceNewsPrefs([])).toEqual(DEFAULT_NEWS_PREFS);
    expect(coerceFollowingPrefs(null)).toEqual(DEFAULT_FOLLOWING_PREFS);
  });

  it("preserve valid fields", () => {
    expect(coerceQuotePrefs({ autoRefreshMs: 60000, showSource: false, showStale: false })).toEqual({
      autoRefreshMs: 60000,
      showSource: false,
      showStale: false,
    });
    expect(coerceFollowingPrefs({ curated: false, autoRefreshMs: 300000 })).toEqual({
      autoRefreshMs: 300000,
      curated: false,
    });
  });

  it("coerce bad autoRefreshMs to 0 and fill missing toggles with defaults", () => {
    expect(coercePortfolioPrefs({ autoRefreshMs: 999, showPositions: false })).toEqual({
      autoRefreshMs: 0,
      showPositions: false,
      showBalances: true,
    });
    expect(coerceWatchlistPrefs({ showBid: true })).toEqual({
      autoRefreshMs: 0,
      showLast: true,
      showChgPct: true,
      showBid: true,
      showAsk: false,
    });
    expect(coerceChartPrefs({ showSource: false })).toEqual({
      autoRefreshMs: 0,
      showSource: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- widgetSettings`
Expected: FAIL — cannot resolve `./widgetSettings`.

- [ ] **Step 3: Write the implementation**

Create `web/app/lib/widgetSettings.ts`:

```ts
// Per-widget UI prefs shapes for the simple widgets (Quote, Portfolio, Watchlist,
// Chart, News, Following). Each is non-secret UI state persisted via useWidgetPrefs.
// Yield has its own richer shape in yieldPrefs.ts. All coercers are pure.

import { coerceAutoRefreshMs, type AutoRefreshMs } from "./autoRefresh";

function asObject(x: unknown): Record<string, unknown> {
  return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
}
function bool(x: unknown, fallback: boolean): boolean {
  return typeof x === "boolean" ? x : fallback;
}

// ---- Quote ----------------------------------------------------------------
export const QUOTE_PREFS_KEY = "omphalos.quote.prefs.v1";
export type QuotePrefs = { autoRefreshMs: AutoRefreshMs; showSource: boolean; showStale: boolean };
export const DEFAULT_QUOTE_PREFS: QuotePrefs = { autoRefreshMs: 0, showSource: true, showStale: true };
export function coerceQuotePrefs(x: unknown): QuotePrefs {
  const p = asObject(x);
  return {
    autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs),
    showSource: bool(p.showSource, true),
    showStale: bool(p.showStale, true),
  };
}

// ---- Portfolio ------------------------------------------------------------
export const PORTFOLIO_PREFS_KEY = "omphalos.portfolio.prefs.v1";
export type PortfolioPrefs = { autoRefreshMs: AutoRefreshMs; showPositions: boolean; showBalances: boolean };
export const DEFAULT_PORTFOLIO_PREFS: PortfolioPrefs = { autoRefreshMs: 0, showPositions: true, showBalances: true };
export function coercePortfolioPrefs(x: unknown): PortfolioPrefs {
  const p = asObject(x);
  return {
    autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs),
    showPositions: bool(p.showPositions, true),
    showBalances: bool(p.showBalances, true),
  };
}

// ---- Watchlist ------------------------------------------------------------
export const WATCHLIST_PREFS_KEY = "omphalos.watchlist.prefs.v1";
export type WatchlistPrefs = {
  autoRefreshMs: AutoRefreshMs;
  showLast: boolean;
  showChgPct: boolean;
  showBid: boolean;
  showAsk: boolean;
};
export const DEFAULT_WATCHLIST_PREFS: WatchlistPrefs = {
  autoRefreshMs: 0,
  showLast: true,
  showChgPct: true,
  showBid: false,
  showAsk: false,
};
export function coerceWatchlistPrefs(x: unknown): WatchlistPrefs {
  const p = asObject(x);
  return {
    autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs),
    showLast: bool(p.showLast, true),
    showChgPct: bool(p.showChgPct, true),
    showBid: bool(p.showBid, false),
    showAsk: bool(p.showAsk, false),
  };
}

// ---- Chart ----------------------------------------------------------------
export const CHART_PREFS_KEY = "omphalos.chart.prefs.v1";
export type ChartPrefs = { autoRefreshMs: AutoRefreshMs; showSource: boolean };
export const DEFAULT_CHART_PREFS: ChartPrefs = { autoRefreshMs: 0, showSource: true };
export function coerceChartPrefs(x: unknown): ChartPrefs {
  const p = asObject(x);
  return {
    autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs),
    showSource: bool(p.showSource, true),
  };
}

// ---- News -----------------------------------------------------------------
export const NEWS_PREFS_KEY = "omphalos.news.prefs.v1";
export type NewsPrefs = { autoRefreshMs: AutoRefreshMs };
export const DEFAULT_NEWS_PREFS: NewsPrefs = { autoRefreshMs: 0 };
export function coerceNewsPrefs(x: unknown): NewsPrefs {
  const p = asObject(x);
  return { autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs) };
}

// ---- Following ------------------------------------------------------------
export const FOLLOWING_PREFS_KEY = "omphalos.following.prefs.v1";
export type FollowingPrefs = { autoRefreshMs: AutoRefreshMs; curated: boolean };
export const DEFAULT_FOLLOWING_PREFS: FollowingPrefs = { autoRefreshMs: 0, curated: true };
export function coerceFollowingPrefs(x: unknown): FollowingPrefs {
  const p = asObject(x);
  return {
    autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs),
    curated: bool(p.curated, true),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- widgetSettings`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/widgetSettings.ts web/app/lib/widgetSettings.test.ts
git commit -m "feat(web): add per-widget prefs shapes + coercers"
```

---

### Task 6: Quote widget adoption

**Files:**
- Modify: `web/app/widgets/QuoteWidget.tsx`

Settings: show/hide "via source", show/hide stale badge, auto-refresh.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/app/widgets/QuoteWidget.tsx` with:

```tsx
"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, StatusNotice, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { AutoRefreshControl, ToggleRow } from "../components/WidgetSettingsMenu";
import { loadQuoteData } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
import { coerceQuotePrefs, DEFAULT_QUOTE_PREFS, QUOTE_PREFS_KEY } from "../lib/widgetSettings";
import type { Quote } from "../lib/api/client";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function QuoteBody({ q, showStale }: { q: Quote; showStale: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "2rem" }}>{fmt(q.last)}</span>
        <span style={{ color: signColor(q.change) }}>
          {q.change != null && q.change > 0 ? "+" : ""}
          {fmt(q.change)} ({fmt(q.changePct)}%)
        </span>
        {showStale && q.stale && <span style={{ color: "#d9a441", fontSize: "0.8rem" }}>stale</span>}
      </div>
      <Row label="bid" value={fmt(q.bid)} />
      <Row label="ask" value={fmt(q.ask)} />
      <Row label="last" value={fmt(q.last)} />
    </div>
  );
}

export default function QuoteWidget({ symbol }: { symbol: string }) {
  const [prefs, setPrefs] = useWidgetPrefs(QUOTE_PREFS_KEY, DEFAULT_QUOTE_PREFS, coerceQuotePrefs);
  const load = useCallback(() => loadQuoteData(symbol), [symbol]);
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);

  const source = prefs.showSource && state.kind === "ok" ? state.data.quote?.source : undefined;

  const settings = (
    <WidgetSettingsMenu title="quote settings">
      <ToggleRow label="Show source" checked={prefs.showSource} onChange={() => setPrefs({ ...prefs, showSource: !prefs.showSource })} />
      <ToggleRow label="Show stale badge" checked={prefs.showStale} onChange={() => setPrefs({ ...prefs, showStale: !prefs.showStale })} />
      <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame title={`Quote · ${symbol}`} source={source} onRefresh={refresh} busy={state.kind === "loading"} headerExtra={settings}>
      <ResourceView state={state}>
        {(data) =>
          data.quote ? <QuoteBody q={data.quote} showStale={prefs.showStale} /> : <StatusNotice status="empty" message="No quote." />
        }
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/widgets/QuoteWidget.tsx
git commit -m "feat(web): add settings menu to Quote widget"
```

---

### Task 7: Portfolio widget adoption

**Files:**
- Modify: `web/app/widgets/PortfolioWidget.tsx`

Settings: toggle IBKR positions section, toggle Kraken balances section, auto-refresh.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/app/widgets/PortfolioWidget.tsx` with:

```tsx
"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { AutoRefreshControl, ToggleRow } from "../components/WidgetSettingsMenu";
import { loadPortfolio } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
import { coercePortfolioPrefs, DEFAULT_PORTFOLIO_PREFS, PORTFOLIO_PREFS_KEY } from "../lib/widgetSettings";

const th: React.CSSProperties = { textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const td: React.CSSProperties = { textAlign: "right", padding: "0.3rem 0.6rem" };
const tdl: React.CSSProperties = { ...td, textAlign: "left" };

export default function PortfolioWidget() {
  const [prefs, setPrefs] = useWidgetPrefs(PORTFOLIO_PREFS_KEY, DEFAULT_PORTFOLIO_PREFS, coercePortfolioPrefs);
  const load = useCallback(() => loadPortfolio(), []);
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);

  const settings = (
    <WidgetSettingsMenu title="portfolio settings">
      <ToggleRow label="Show positions (IBKR)" checked={prefs.showPositions} onChange={() => setPrefs({ ...prefs, showPositions: !prefs.showPositions })} />
      <ToggleRow label="Show balances (Kraken)" checked={prefs.showBalances} onChange={() => setPrefs({ ...prefs, showBalances: !prefs.showBalances })} />
      <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame title="Portfolio" onRefresh={refresh} busy={state.kind === "loading"} headerExtra={settings}>
      <ResourceView state={state}>
        {(data) => (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {prefs.showPositions && (
              <section>
                <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                  POSITIONS (IBKR)
                </h3>
                {data.positions.length === 0 ? (
                  <p style={{ color: "var(--muted)" }}>No positions.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                        <th style={th}>Qty</th>
                        <th style={th}>Avg Cost</th>
                        <th style={th}>Mkt Value</th>
                        <th style={th}>Unrl P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.positions.map((p) => (
                        <tr key={p.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={tdl}>{p.symbol}</td>
                          <td style={td}>{fmt(p.qty, 0)}</td>
                          <td style={td}>{fmt(p.avgCost)}</td>
                          <td style={td}>{fmt(p.marketValue)}</td>
                          <td style={{ ...td, color: signColor(p.unrealizedPnl) }}>{fmt(p.unrealizedPnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {prefs.showBalances && (
              <section>
                <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                  BALANCES (Kraken)
                </h3>
                {data.balances.length === 0 ? (
                  <p style={{ color: "var(--muted)" }}>No balances.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, textAlign: "left" }}>Asset</th>
                        <th style={th}>Total</th>
                        <th style={th}>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.balances.map((b) => (
                        <tr key={b.asset} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={tdl}>{b.asset}</td>
                          <td style={td}>{fmt(b.total, 4)}</td>
                          <td style={td}>{fmt(b.available, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {!prefs.showPositions && !prefs.showBalances && (
              <p style={{ color: "var(--muted)" }}>Both sections hidden — enable one in ⚙ settings.</p>
            )}
          </div>
        )}
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/widgets/PortfolioWidget.tsx
git commit -m "feat(web): add settings menu to Portfolio widget"
```

---

### Task 8: Watchlist widget adoption

**Files:**
- Modify: `web/app/widgets/WatchlistWidget.tsx`

Settings: show/hide Last, Chg%, Bid, Ask columns; auto-refresh. Symbol and the remove (✕) column are always shown. Bid/Ask are new optional columns sourced from the existing `Quote` shape.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/app/widgets/WatchlistWidget.tsx` with:

```tsx
"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { AutoRefreshControl, ToggleRow } from "../components/WidgetSettingsMenu";
import { loadWatchlist } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
import { coerceWatchlistPrefs, DEFAULT_WATCHLIST_PREFS, WATCHLIST_PREFS_KEY } from "../lib/widgetSettings";

const th: React.CSSProperties = { color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const num: React.CSSProperties = { textAlign: "right", padding: "0.3rem 0.6rem" };

export default function WatchlistWidget() {
  const { watchlist } = useTerminal();
  const key = watchlist.join(",");
  const [prefs, setPrefs] = useWidgetPrefs(WATCHLIST_PREFS_KEY, DEFAULT_WATCHLIST_PREFS, coerceWatchlistPrefs);
  // Refetch whenever the set of watched symbols changes.
  const load = useCallback(() => loadWatchlist(watchlist), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);

  const settings = (
    <WidgetSettingsMenu title="watchlist settings">
      <ToggleRow label="Last" checked={prefs.showLast} onChange={() => setPrefs({ ...prefs, showLast: !prefs.showLast })} />
      <ToggleRow label="Chg %" checked={prefs.showChgPct} onChange={() => setPrefs({ ...prefs, showChgPct: !prefs.showChgPct })} />
      <ToggleRow label="Bid" checked={prefs.showBid} onChange={() => setPrefs({ ...prefs, showBid: !prefs.showBid })} />
      <ToggleRow label="Ask" checked={prefs.showAsk} onChange={() => setPrefs({ ...prefs, showAsk: !prefs.showAsk })} />
      <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame title="Watchlist" onRefresh={refresh} busy={state.kind === "loading"} headerExtra={settings}>
      <ResourceView state={state}>
        {(data) =>
          data.quotes.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Watchlist is empty. Add with: <code>watch &lt;SYMBOL&gt;</code></p>
          ) : (
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
                {data.quotes.map((q) => (
                  <tr key={q.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.3rem 0.6rem" }}>
                      <button
                        onClick={() => terminalStore.dispatch(`chart ${q.symbol}`)}
                        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                        title="open chart"
                      >
                        {q.symbol}
                      </button>
                    </td>
                    {prefs.showLast && <td style={num}>{fmt(q.last)}</td>}
                    {prefs.showBid && <td style={num}>{fmt(q.bid)}</td>}
                    {prefs.showAsk && <td style={num}>{fmt(q.ask)}</td>}
                    {prefs.showChgPct && <td style={{ ...num, color: signColor(q.changePct) }}>{fmt(q.changePct)}%</td>}
                    <td style={{ ...num }}>
                      <button
                        onClick={() => terminalStore.dispatch(`unwatch ${q.symbol}`)}
                        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                        title="remove from watchlist"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: PASS. (If `q.bid` / `q.ask` are not on the watchlist quote type, the build fails here — the FE types are generated from the backend `Quote` model, which includes `bid`/`ask`. If it fails, that is a real type error to resolve, not a guess.)

- [ ] **Step 3: Commit**

```bash
git add web/app/widgets/WatchlistWidget.tsx
git commit -m "feat(web): add settings menu + optional columns to Watchlist widget"
```

---

### Task 9: Chart widget adoption

**Files:**
- Modify: `web/app/widgets/ChartWidget.tsx`

Settings: auto-refresh, show/hide "via source". Span/interval stay inline (primary interaction).

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/app/widgets/ChartWidget.tsx` with:

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import CandleChart from "../components/CandleChart";
import ChartControls from "../components/ChartControls";
import { ResourceView, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { AutoRefreshControl, ToggleRow } from "../components/WidgetSettingsMenu";
import { resolveRange } from "../lib/chart/range";
import type { Interval, Span } from "../lib/chart/range";
import { loadChartData } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { loadAppSettings } from "../lib/appSettings";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
import { CHART_PREFS_KEY, coerceChartPrefs, DEFAULT_CHART_PREFS } from "../lib/widgetSettings";

export default function ChartWidget({ symbol }: { symbol: string }) {
  // Initial range from the user's saved defaults (default 1M/1h), snapped to a
  // valid span/interval pair.
  const init = useMemo(() => {
    const s = loadAppSettings();
    return resolveRange(s.defaultSpan, s.defaultInterval);
  }, []);
  const [span, setSpan] = useState<Span>(init.span);
  const [interval, setInterval] = useState<Interval>(init.interval);
  const [prefs, setPrefs] = useWidgetPrefs(CHART_PREFS_KEY, DEFAULT_CHART_PREFS, coerceChartPrefs);

  const load = useCallback(() => loadChartData(symbol, interval, span), [symbol, interval, span]);
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);
  const source = prefs.showSource && state.kind === "ok" ? state.data.source : undefined;

  // Picking a span may snap the interval (resolveRange) so the pair stays valid.
  const selectSpan = (s: Span) => {
    const r = resolveRange(s, interval);
    setSpan(r.span);
    setInterval(r.interval);
  };

  const settings = (
    <WidgetSettingsMenu title="chart settings">
      <ToggleRow label="Show source" checked={prefs.showSource} onChange={() => setPrefs({ ...prefs, showSource: !prefs.showSource })} />
      <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame title={`Chart · ${symbol}`} source={source} onRefresh={refresh} busy={state.kind === "loading"} headerExtra={settings}>
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

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/widgets/ChartWidget.tsx
git commit -m "feat(web): add settings menu to Chart widget"
```

---

### Task 10: News widget adoption (move FeedBar into the menu)

**Files:**
- Modify: `web/app/widgets/NewsWidget.tsx`

The `FeedBar` (source chips + add-feed form) moves out of the body and into the settings popover; add auto-refresh. The popover is wider (`minWidth={300}`) to fit the URL input. `FeedBar`'s internal state/behavior is unchanged — only its render location.

- [ ] **Step 1: Edit imports**

In `web/app/widgets/NewsWidget.tsx`, replace the import block (lines 1-9) with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { AutoRefreshControl } from "../components/WidgetSettingsMenu";
import { addFeed, loadFeeds, loadNews } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
import { coerceNewsPrefs, DEFAULT_NEWS_PREFS, NEWS_PREFS_KEY } from "../lib/widgetSettings";
import { terminalStore } from "../lib/store";
import type { FeedInfo } from "../lib/api/client";
import { absTime, timeAgo } from "../lib/format";
```

- [ ] **Step 2: Remove the outer margin wrapper from FeedBar**

`FeedBar` currently wraps its content in `<div style={{ marginBottom: "1rem" }}>`. Inside the popover it should not add bottom margin. Change the opening wrapper (line 58) from:

```tsx
    <div style={{ marginBottom: "1rem" }}>
```

to:

```tsx
    <div>
```

(Leave the rest of `FeedBar` — chips, inputs, add button, error — exactly as is.)

- [ ] **Step 3: Replace the `NewsWidget` default export**

Replace the `NewsWidget` function (the `export default function NewsWidget(...)` block) with:

```tsx
export default function NewsWidget({ feed }: { feed?: string }) {
  const [prefs, setPrefs] = useWidgetPrefs(NEWS_PREFS_KEY, DEFAULT_NEWS_PREFS, coerceNewsPrefs);
  const load = useCallback(() => loadNews(feed), [feed]);
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);

  const settings = (
    <WidgetSettingsMenu title="news settings" label="⚙ feeds" minWidth={300}>
      <FeedBar active={feed} />
      <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.6rem", paddingTop: "0.4rem" }}>
        <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
      </div>
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title={feed ? `News · ${feed}` : "News · All"}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
    >
      <ResourceView state={state}>
        {(data) =>
          data.items.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No headlines.</p>
          ) : (
            <div role="table" style={{ display: "flex", flexDirection: "column" }}>
              <div
                role="row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: "0.8rem",
                  padding: "0 0 0.4rem",
                  color: "var(--muted)",
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <span>Headline</span>
                <span>Source</span>
                <span>Time</span>
              </div>
              {data.items.map((item) => (
                <div
                  key={item.url}
                  role="row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    alignItems: "baseline",
                    gap: "0.8rem",
                    padding: "0.4rem 0",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.summary || item.title}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}
                  >
                    {item.title}
                  </a>
                  <span style={{ color: "var(--muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                    {item.feed}
                  </span>
                  <span
                    title={timeAgo(item.publishedTs)}
                    style={{ color: "var(--muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}
                  >
                    {absTime(item.publishedTs)}
                  </span>
                </div>
              ))}
            </div>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/widgets/NewsWidget.tsx
git commit -m "feat(web): move News feed selector + add-feed into settings menu"
```

---

### Task 11: Following widget adoption

**Files:**
- Modify: `web/app/widgets/FollowingWidget.tsx`

Settings: a "Curated view" toggle (persisted) + auto-refresh. The inline `CuratedToggle` stays (it carries the dynamic "N hidden — show all" hint) and reads/writes the same persisted `curated` pref. The roster + follow-input stay in the body (they are the widget's primary content, not settings).

- [ ] **Step 1: Edit imports**

In `web/app/widgets/FollowingWidget.tsx`, replace the import block (lines 1-10) with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ResourceView, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { AutoRefreshControl, ToggleRow } from "../components/WidgetSettingsMenu";
import { loadPeopleFeed } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
import { coerceFollowingPrefs, DEFAULT_FOLLOWING_PREFS, FOLLOWING_PREFS_KEY } from "../lib/widgetSettings";
import type { FollowItem } from "../lib/api/client";
import { CuratedToggle, FeedItemList } from "../components/FeedItemList";
```

- [ ] **Step 2: Replace local state + add settings menu + auto-refresh**

Find this block (lines 21-31):

```tsx
  const [filter, setFilter] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [curated, setCurated] = useState(true);

  const load = useCallback(
    () => loadPeopleFeed(following),
    // `key` digests every person's name+feeds — the real refetch trigger; `following`
    // is a fresh array reference each render, so we intentionally key on the digest.
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { state, refresh } = useResource(load);
```

Replace with:

```tsx
  const [filter, setFilter] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [prefs, setPrefs] = useWidgetPrefs(FOLLOWING_PREFS_KEY, DEFAULT_FOLLOWING_PREFS, coerceFollowingPrefs);
  const curated = prefs.curated;
  const setCurated = (next: boolean) => setPrefs({ ...prefs, curated: next });

  const load = useCallback(
    () => loadPeopleFeed(following),
    // `key` digests every person's name+feeds — the real refetch trigger; `following`
    // is a fresh array reference each render, so we intentionally key on the digest.
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);

  const settings = (
    <WidgetSettingsMenu title="following settings">
      <ToggleRow label="Curated view" checked={prefs.curated} onChange={() => setCurated(!prefs.curated)} />
      <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
    </WidgetSettingsMenu>
  );
```

- [ ] **Step 3: Pass `headerExtra` to WidgetFrame**

Find (line 40):

```tsx
    <WidgetFrame title="Following" onRefresh={refresh} busy={state.kind === "loading"}>
```

Replace with:

```tsx
    <WidgetFrame title="Following" onRefresh={refresh} busy={state.kind === "loading"} headerExtra={settings}>
```

- [ ] **Step 4: Update the inline CuratedToggle handlers**

The inline `CuratedToggle` (line 74) currently calls `onToggle={() => setCurated((v) => !v)}` and `onShowAll={() => setCurated(false)}`. Since `setCurated` is now a plain setter (not a React state updater), change line 74 from:

```tsx
              <CuratedToggle curated={curated} hidden={hidden} onToggle={() => setCurated((v) => !v)} onShowAll={() => setCurated(false)} />
```

to:

```tsx
              <CuratedToggle curated={curated} hidden={hidden} onToggle={() => setCurated(!curated)} onShowAll={() => setCurated(false)} />
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/app/widgets/FollowingWidget.tsx
git commit -m "feat(web): add settings menu + persist curated view to Following widget"
```

---

### Task 12: Yield widget — fold popover onto shared component + add auto-refresh

**Files:**
- Modify: `web/app/lib/yieldPrefs.ts`
- Modify: `web/app/widgets/YieldWidget.tsx`

Goal: add `autoRefreshMs` to `YieldPrefs`; replace the bespoke `loadYieldPrefs`/`saveYieldPrefs` with a pure `coerceYieldPrefs` used through `useWidgetPrefs`; replace the bespoke popover button/div in `SettingsPopover` with the shared `WidgetSettingsMenu`, keeping the curve table content and adding `AutoRefreshControl`.

- [ ] **Step 1: Confirm no other importers of the old load/save**

Run: `grep -rn "loadYieldPrefs\|saveYieldPrefs" web/app`
Expected: matches only in `web/app/lib/yieldPrefs.ts` and `web/app/widgets/YieldWidget.tsx`. (If other files import them, update those imports too in this task.)

- [ ] **Step 2: Add `autoRefreshMs` to the type + default**

In `web/app/lib/yieldPrefs.ts`, add the import near the top (after the file's leading comment):

```ts
import { coerceAutoRefreshMs, type AutoRefreshMs } from "./autoRefresh";
```

Change the `YieldPrefs` type (lines 19-23) from:

```ts
export type YieldPrefs = {
  currentOnChart: boolean;
  compares: CompareCurve[];
  colorTheme: ColorTheme;
};
```

to:

```ts
export type YieldPrefs = {
  currentOnChart: boolean;
  compares: CompareCurve[];
  colorTheme: ColorTheme;
  autoRefreshMs: AutoRefreshMs;
};
```

Change `DEFAULT_YIELD_PREFS` (lines 63-74) to add the field — replace its closing lines:

```ts
  colorTheme: "vivid",
};
```

with:

```ts
  colorTheme: "vivid",
  autoRefreshMs: 0,
};
```

- [ ] **Step 3: Replace load/save with coerce + readPrefs/writePrefs**

In `web/app/lib/yieldPrefs.ts`, add the readPrefs/writePrefs import near the other top import:

```ts
import { readPrefs, writePrefs } from "./widgetPrefs";
```

Replace the whole load/save block (lines 107-133, from `const STORAGE_KEY` through the end of `saveYieldPrefs`) with:

```ts
export const YIELD_PREFS_KEY = "omphalos.yield.prefs.v1";

// Pure: validate untrusted parsed JSON into a YieldPrefs (localStorage is untrusted).
export function coerceYieldPrefs(parsed: unknown): YieldPrefs {
  const p = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Partial<YieldPrefs>;
  if (!Array.isArray(p.compares)) return DEFAULT_YIELD_PREFS;
  return {
    currentOnChart: typeof p.currentOnChart === "boolean" ? p.currentOnChart : true,
    compares: sortCompares(p.compares.filter(isCompareCurve)),
    colorTheme: isColorTheme(p.colorTheme) ? p.colorTheme : "vivid",
    autoRefreshMs: coerceAutoRefreshMs(p.autoRefreshMs),
  };
}

export function loadYieldPrefs(): YieldPrefs {
  return readPrefs(YIELD_PREFS_KEY, DEFAULT_YIELD_PREFS, coerceYieldPrefs);
}

export function saveYieldPrefs(prefs: YieldPrefs): void {
  writePrefs(YIELD_PREFS_KEY, prefs);
}
```

- [ ] **Step 4: Run yield tests (regression)**

Run: `npm test -- yieldPrefs`
Expected: PASS (existing tests still pass — they check specific fields, not whole-object equality, so the new `autoRefreshMs` field doesn't break them).

- [ ] **Step 5: Wire YieldWidget to useWidgetPrefs**

In `web/app/widgets/YieldWidget.tsx`, update the imports. Change the prefs import block (lines 7-21) to add `YIELD_PREFS_KEY` and `coerceYieldPrefs`, and remove `loadYieldPrefs`/`saveYieldPrefs`:

```tsx
import {
  type YieldPrefs,
  type CompareCurve,
  type ColorTheme,
  DEFAULT_YIELD_PREFS,
  compareKey,
  exactDates,
  toggleChart,
  toggleDelta,
  addExactDate,
  removeCompare,
  setColorTheme,
  coerceYieldPrefs,
  YIELD_PREFS_KEY,
} from "../lib/yieldPrefs";
```

Add these imports after the existing `../components/ui` import (line 3):

```tsx
import WidgetSettingsMenu, { AutoRefreshControl } from "../components/WidgetSettingsMenu";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { useAutoRefresh } from "../lib/autoRefresh";
```

Update the React import on line 2 to drop the now-unused `useState`/`useCallback` if they become unused — but `useState` and `useCallback` are still used by `SettingsPopover` (`dateInput`) and `load`. Keep line 2 as is:

```tsx
import { useCallback, useMemo, useState } from "react";
```

- [ ] **Step 6: Replace the YieldWidget prefs state + add auto-refresh**

In `web/app/widgets/YieldWidget.tsx`, replace this block (lines 254-266):

```tsx
export default function YieldWidget() {
  const [prefs, setPrefsState] = useState<YieldPrefs>(() => loadYieldPrefs());
  const setPrefs = useCallback((p: YieldPrefs) => {
    setPrefsState(p);
    saveYieldPrefs(p);
  }, []);

  const asof = exactDates(prefs);
  const asofKey = asof.join(",");
  const load = useCallback(() => loadYield(asof), [asofKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { state, refresh } = useResource(load);

  const settings = <SettingsPopoverWrapper prefs={prefs} setPrefs={setPrefs} state={state} />;
```

with:

```tsx
export default function YieldWidget() {
  const [prefs, setPrefs] = useWidgetPrefs(YIELD_PREFS_KEY, DEFAULT_YIELD_PREFS, coerceYieldPrefs);

  const asof = exactDates(prefs);
  const asofKey = asof.join(",");
  const load = useCallback(() => loadYield(asof), [asofKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { state, refresh } = useResource(load);
  useAutoRefresh(refresh, prefs.autoRefreshMs);

  const settings = <SettingsPopoverWrapper prefs={prefs} setPrefs={setPrefs} state={state} />;
```

- [ ] **Step 7: Replace the bespoke popover chrome in SettingsPopover with WidgetSettingsMenu**

In `web/app/widgets/YieldWidget.tsx`, the `SettingsPopover` function (lines 76-252) currently manages its own `open` state and renders its own button + absolutely-positioned div. Replace the function so it uses `WidgetSettingsMenu` for the chrome, keeps the curve `<table>` + add-date + color-theme content, and appends an `AutoRefreshControl`.

Replace from the function signature down through the end of the function. Specifically, replace lines 85-251 (from `const [open, setOpen] = useState(false);` through the final `</div>` and closing of the `open && (...)` block, i.e. everything between the `{` after the props destructure and the function's closing `}`) with this body:

```tsx
  const [dateInput, setDateInput] = useState("");
  const cell: React.CSSProperties = { padding: "0.2rem 0.5rem", fontSize: "0.85rem" };

  return (
    <WidgetSettingsMenu label="⚙ curves" title="yield curve settings" minWidth={260}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
            <th style={{ ...cell, textAlign: "left" }}>Curve</th>
            <th style={cell}>Chart</th>
            <th style={cell}>Δ</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>Today</td>
            <td style={{ ...cell, textAlign: "center" }}>
              <input
                type="checkbox"
                checked={prefs.currentOnChart}
                onChange={() => setPrefs({ ...prefs, currentOnChart: !prefs.currentOnChart })}
              />
            </td>
            <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>ref</td>
            <td style={cell} />
          </tr>
          {prefs.compares.map((c) => {
            const key = compareKey(c);
            const resolved = curvesByKey.get(key);
            return (
              <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={cell}>
                  {c.kind === "relative" ? c.period.toUpperCase() : c.date}
                  {resolved && (
                    <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: "0.72rem" }}>
                      {fmtDate(resolved.obsDate)}
                    </span>
                  )}
                </td>
                <td style={{ ...cell, textAlign: "center" }}>
                  <input type="checkbox" checked={c.onChart} onChange={() => setPrefs(toggleChart(prefs, key))} />
                </td>
                <td style={{ ...cell, textAlign: "center" }}>
                  <input type="checkbox" checked={c.showDelta} onChange={() => setPrefs(toggleDelta(prefs, key))} />
                </td>
                <td style={{ ...cell, textAlign: "center" }}>
                  {c.kind === "exact" && (
                    <button
                      onClick={() => setPrefs(removeCompare(prefs, key))}
                      style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
                      aria-label={`remove ${key}`}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.6rem" }}>
        <input
          type="date"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          style={{
            flex: 1,
            background: "transparent",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.2rem 0.4rem",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => {
            if (dateInput) {
              setPrefs(addExactDate(prefs, dateInput));
              setDateInput("");
            }
          }}
          style={{
            background: "transparent",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.2rem 0.6rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          add
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem", fontSize: "0.85rem" }}>
        <span style={{ color: "var(--muted)" }}>Colors</span>
        <select
          value={prefs.colorTheme}
          onChange={(e) => setPrefs(setColorTheme(prefs, e.target.value as ColorTheme))}
          style={{
            flex: 1,
            background: "var(--background)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.2rem 0.4rem",
            fontFamily: "inherit",
          }}
        >
          {(Object.keys(COLOR_THEMES) as ColorTheme[]).map((k) => (
            <option key={k} value={k}>
              {COLOR_THEMES[k].label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ borderTop: "1px solid var(--border)", marginTop: "0.6rem", paddingTop: "0.4rem" }}>
        <AutoRefreshControl value={prefs.autoRefreshMs} onChange={(ms) => setPrefs({ ...prefs, autoRefreshMs: ms })} />
      </div>
      <button
        onClick={() => setPrefs(DEFAULT_YIELD_PREFS)}
        style={{
          marginTop: "0.5rem",
          background: "transparent",
          color: "var(--muted)",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.8rem",
        }}
      >
        reset to defaults
      </button>
    </WidgetSettingsMenu>
  );
```

Note: the `SettingsPopover` props (`prefs`, `setPrefs`, `curvesByKey`) and the comment above it are unchanged; only its body is replaced. The `COLOR_THEMES`/`themeColors` imports (line 22) stay.

- [ ] **Step 8: Verify build + lint + full test run**

Run: `npm run lint && npm run build && npm test`
Expected: PASS, including the existing yield/store/parser tests.

- [ ] **Step 9: Commit**

```bash
git add web/app/lib/yieldPrefs.ts web/app/widgets/YieldWidget.tsx
git commit -m "refactor(web): fold Yield popover onto shared WidgetSettingsMenu + add auto-refresh"
```

---

### Task 13: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full automated check**

Run: `npm run lint && npm run build && npm test`
Expected: lint clean, build succeeds, all tests pass. Capture the test count.

- [ ] **Step 2: Manual dev checklist**

Start the app (frontend :3000, backend :8000 per CLAUDE.md) and verify in the browser. For each widget, open it via the command bar and confirm:

- [ ] **News** (`news`): header shows a `⚙ feeds` button; clicking opens a popover with the source chips + add-feed form + Auto-refresh select. The body no longer shows the feed bar inline. Adding a feed still opens the new feed tab. Clicking outside the popover closes it.
- [ ] **Quote** (`quote AAPL`): `⚙` opens Show source / Show stale badge / Auto-refresh. Toggling "Show source" hides/shows the `via …` label; toggling stale hides the badge.
- [ ] **Portfolio** (`port`): `⚙` toggles the IBKR and Kraken sections; hiding both shows the "enable one in ⚙ settings" hint.
- [ ] **Watchlist** (`watch AAPL` then open watchlist): `⚙` toggles Last/Chg%/Bid/Ask columns; columns appear/disappear.
- [ ] **Chart** (`chart AAPL`): span/interval remain inline; `⚙` has Show source + Auto-refresh.
- [ ] **Following** (`following`): `⚙` has Curated view + Auto-refresh; toggling Curated also updates the inline "N hidden — show all" toggle, and the choice persists across reload.
- [ ] **Yield** (`yield`): `⚙ curves` opens the same curve table + add-date + colors as before, now with an Auto-refresh row and "reset to defaults".
- [ ] **Auto-refresh**: set a widget to 30s, watch the network panel re-issue the snapshot request ~every 30s; set back to Off and confirm polling stops.
- [ ] **Persistence**: change several settings, reload the page, confirm they're restored.
- [ ] **No gear on Help/Calendar**: `help` and `cal` widgets have no gear (unchanged).

- [ ] **Step 3: Update memory index**

The settings-menu feature is now complete. Optionally note this in the project memory if tracking feature status there.

---

## Self-review notes

- **Spec coverage:** Shared `WidgetSettingsMenu` (Task 4), `useWidgetPrefs` (Task 2), `useAutoRefresh` (Task 3), per-widget contents table (Tasks 6-12), auto-refresh options Off/30s/1m/5m (Task 3), localStorage `omphalos.<widget>.prefs.v1` keys (Tasks 5, 12), CLAUDE.md rule #5 amendment (Task 1), Yield fold-in + `yieldPrefs` refactor (Task 12). All spec items mapped.
- **Type consistency:** `coerceAutoRefreshMs`/`AutoRefreshMs`/`AUTO_REFRESH_OPTIONS` (Task 3) reused by `widgetSettings.ts` (Task 5), `WidgetSettingsMenu` (Task 4), and Yield (Task 12). `useWidgetPrefs(key, defaults, coerce)` signature consistent across all adopt tasks. Prefs key/default/coerce names match between Task 5 definitions and Tasks 6-11 imports.
- **Testing deviation (flagged):** pure logic is TDD'd; React glue is build/lint/manual-verified, matching the codebase's node-only pure-function test convention (no RTL exists). Documented in the "Testing approach" section.
- **Watchlist Bid/Ask risk:** depends on `Quote.bid`/`Quote.ask` existing in the generated FE types (they do per the canonical Quote shape); Task 8 Step 2 build will catch it if not.
