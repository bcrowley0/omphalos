# Widget Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an off-by-default, per-widget "auto" toggle to the four live-data widgets (quote, watchlist, portfolio, chart) that silently re-fetches on a fixed, bounded interval — a documented relaxation of `CLAUDE.md` rule 5.

**Architecture:** All timer logic lives in a pure, framework-agnostic `autoRefreshController` (unit-tested with fake timers). The shared `useResource` hook gains a thin wiring layer that drives that controller, adds a non-blanking `backgroundRefresh`, and exposes `isRefreshing`. Fixed intervals and the eligible-widget set live in a pure `autoRefresh` module. The per-tab toggle is persisted in a dedicated `autoRefreshPrefs` localStorage module (mirroring the existing `appSettings`/`yieldPrefs` pattern). The shared `WidgetFrame` chrome renders the toggle.

**Tech Stack:** Next.js (App Router) + React 19 + TypeScript; Vitest (node env, `// @vitest-environment jsdom` per-file when DOM is needed); no `@testing-library/react` in the repo.

---

## Testing approach (read first)

This repo tests **pure functions only** — there are no React component/hook tests, and `@testing-library/react` is intentionally absent. This plan honors that:

- **Pure modules** (Tasks 1–3) get full TDD: failing test → implement → pass.
- **React glue** (Tasks 4–8: `useResource`, the toggle hook, `WidgetFrame`, widget wiring, `CLAUDE.md`) is verified by **`npm run build` (tsc) + `npm run lint`** at each task and a **manual run** in Task 9. The hard logic was deliberately pushed into the pure controller so it *is* unit-tested. Do not add `@testing-library/react`.

Run all unit tests with `cd web && npm test`. Run the dev app (for Task 9) per the worktree's `./dev.sh`.

## Deviations from the approved spec (intentional)

1. **Persistence lives in a dedicated `autoRefreshPrefs.ts`**, not in `terminalStore`. This matches the existing per-feature prefs pattern (`appSettings.ts`, `yieldPrefs.ts`), keeps the singleton store focused, and avoids threading new state through `useSyncExternalStore`. Still localStorage, still keyed per tab id.
2. **`isRefreshing` is returned as a separate value** from `useResource` rather than embedded in the `ResourceState` union — this avoids touching `ResourceView` and every other consumer of the union.
3. **Timer/visibility/auto-disable is split** into a pure `autoRefreshController` so it is unit-testable without a React renderer.

## File structure

- Create `web/app/lib/autoRefresh.ts` — intervals, eligibility, health predicate (pure).
- Create `web/app/lib/autoRefresh.test.ts` — tests for the above (node env).
- Create `web/app/lib/autoRefreshController.ts` — pure timer + visibility controller.
- Create `web/app/lib/autoRefreshController.test.ts` — tests (node env, fake timers).
- Create `web/app/lib/autoRefreshPrefs.ts` — per-tab toggle persistence (localStorage).
- Create `web/app/lib/autoRefreshPrefs.test.ts` — tests (jsdom env).
- Create `web/app/lib/useAutoRefreshToggle.ts` — thin client hook over the prefs module.
- Modify `web/app/lib/useResource.ts` — `backgroundRefresh`, `isRefreshing`, controller wiring.
- Modify `web/app/components/ui.tsx` — `WidgetFrame` auto toggle + "updating…" indicator.
- Modify `web/app/components/WidgetHost.tsx` — pass `tabId={tab.id}` to the 4 eligible widgets.
- Modify `web/app/widgets/{Quote,Watchlist,Portfolio,Chart}Widget.tsx` — wire the toggle.
- Modify `CLAUDE.md` — reword rule 5.

---

### Task 1: `autoRefresh` — intervals, eligibility, health predicate

**Files:**
- Create: `web/app/lib/autoRefresh.ts`
- Test: `web/app/lib/autoRefresh.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/autoRefresh.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AUTO_REFRESH_MS,
  autoRefreshMsFor,
  isAutoRefreshEligible,
  isHealthyStatus,
  statusIsHealthy,
} from "./autoRefresh";

describe("autoRefresh", () => {
  it("eligible set is exactly quote/watchlist/portfolio/chart", () => {
    for (const w of ["quote", "watchlist", "portfolio", "chart"]) {
      expect(isAutoRefreshEligible(w)).toBe(true);
    }
    for (const w of ["news", "yield", "cal", "help", "settings", "following", "person"]) {
      expect(isAutoRefreshEligible(w)).toBe(false);
    }
  });

  it("every interval is >= 15s and a whole number of seconds", () => {
    for (const ms of Object.values(AUTO_REFRESH_MS)) {
      expect(ms).toBeGreaterThanOrEqual(15_000);
      expect(ms % 1000).toBe(0);
    }
  });

  it("autoRefreshMsFor returns the mapped interval", () => {
    expect(autoRefreshMsFor("quote")).toBe(15_000);
    expect(autoRefreshMsFor("chart")).toBe(30_000);
  });

  it("isHealthyStatus: ok/empty are healthy, degraded states are not", () => {
    expect(isHealthyStatus("ok")).toBe(true);
    expect(isHealthyStatus("empty")).toBe(true);
    for (const s of ["source_down", "unauthenticated", "rate_limited", "not_implemented"] as const) {
      expect(isHealthyStatus(s)).toBe(false);
    }
  });

  it("statusIsHealthy reads .status off any envelope", () => {
    expect(statusIsHealthy({ status: "ok" })).toBe(true);
    expect(statusIsHealthy({ status: "source_down" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/autoRefresh.test.ts`
Expected: FAIL — cannot find module `./autoRefresh`.

- [ ] **Step 3: Write minimal implementation**

Create `web/app/lib/autoRefresh.ts`:

```ts
// Fixed per-widget-type auto-refresh intervals + eligibility. Pure: the single
// source of truth for "which widgets can auto-refresh and how often". Each
// interval is >= the backing source's cache TTL, so the timer never out-paces
// the cache (CLAUDE.md rule 5: bounded auto-refresh; no source hit faster than
// its TTL). See docs/superpowers/specs/2026-05-31-widget-auto-refresh-design.md.
import type { SourceStatus } from "./api/client";

export type AutoRefreshWidget = "quote" | "watchlist" | "portfolio" | "chart";

export const AUTO_REFRESH_MS: Record<AutoRefreshWidget, number> = {
  quote: 15_000, // Kraken ticker TTL 15s; IBKR snapshot uncached
  watchlist: 30_000, // multi-symbol, heavier
  portfolio: 30_000, // IBKR + Kraken, auth-sensitive
  chart: 30_000, // Kraken OHLC TTL 30s; IBKR candles uncached
};

const ELIGIBLE = new Set<string>(Object.keys(AUTO_REFRESH_MS));

export function isAutoRefreshEligible(widget: string): widget is AutoRefreshWidget {
  return ELIGIBLE.has(widget);
}

export function autoRefreshMsFor(widget: AutoRefreshWidget): number {
  return AUTO_REFRESH_MS[widget];
}

// A result is "healthy" (keep auto-refreshing) only when the source returned
// data or a legitimately empty set. Any degraded state stops the timer.
export function isHealthyStatus(status: SourceStatus): boolean {
  return status === "ok" || status === "empty";
}

// Convenience for any canonical envelope (all loaders return { status }). Stable
// module-level reference so widgets can pass it without re-memoizing.
export function statusIsHealthy<T extends { status: SourceStatus }>(data: T): boolean {
  return isHealthyStatus(data.status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/autoRefresh.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/autoRefresh.ts web/app/lib/autoRefresh.test.ts
git commit -m "feat(web): auto-refresh intervals, eligibility, health predicate"
```

---

### Task 2: `autoRefreshController` — pure timer + visibility gating

**Files:**
- Create: `web/app/lib/autoRefreshController.ts`
- Test: `web/app/lib/autoRefreshController.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/autoRefreshController.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoRefreshController } from "./autoRefreshController";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutoRefreshController", () => {
  it("ticks on the interval after start (when visible)", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it("does not tick while hidden; resumes with an immediate tick when visible", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    c.setVisible(false);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(0);
    c.setVisible(true); // immediate refresh on resume
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onTick).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it("stop() clears the timer; isRunning() reflects state", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    expect(c.isRunning()).toBe(true);
    c.stop();
    expect(c.isRunning()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(0);
  });

  it("setVisible(true) without start does not begin ticking", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.setVisible(true);
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(0);
    expect(c.isRunning()).toBe(false);
  });

  it("setVisible(true) while already visible does not double-fire", () => {
    const onTick = vi.fn();
    const c = createAutoRefreshController({ intervalMs: 1000, onTick });
    c.start();
    c.setVisible(true); // no transition hidden->visible, so no immediate tick
    expect(onTick).toHaveBeenCalledTimes(0);
    c.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/autoRefreshController.test.ts`
Expected: FAIL — cannot find module `./autoRefreshController`.

- [ ] **Step 3: Write minimal implementation**

Create `web/app/lib/autoRefreshController.ts`:

```ts
// Framework-agnostic auto-refresh timer with visibility gating. Pure logic (no
// React, no document access) so it is unit-testable with fake timers. The hook
// owns reading document.visibilityState and feeds it in via setVisible().
export type AutoRefreshController = {
  start: () => void;
  stop: () => void;
  setVisible: (visible: boolean) => void;
  isRunning: () => boolean;
};

export function createAutoRefreshController(opts: {
  intervalMs: number;
  onTick: () => void;
}): AutoRefreshController {
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let visible = true;

  const clear = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  // Run the interval only while started AND visible; otherwise idle.
  const sync = () => {
    if (started && visible) {
      if (timer === null) timer = setInterval(opts.onTick, opts.intervalMs);
    } else {
      clear();
    }
  };

  return {
    start() {
      started = true;
      sync();
    },
    stop() {
      started = false;
      clear();
    },
    setVisible(next: boolean) {
      const was = visible;
      visible = next;
      // Coming back into view after being hidden: refresh immediately, then
      // resume the regular cadence.
      if (started && next && !was) opts.onTick();
      sync();
    },
    isRunning() {
      return timer !== null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/autoRefreshController.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/autoRefreshController.ts web/app/lib/autoRefreshController.test.ts
git commit -m "feat(web): pure auto-refresh controller (timer + visibility gating)"
```

---

### Task 3: `autoRefreshPrefs` — per-tab toggle persistence

**Files:**
- Create: `web/app/lib/autoRefreshPrefs.ts`
- Test: `web/app/lib/autoRefreshPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/app/lib/autoRefreshPrefs.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadAutoRefresh, saveAutoRefresh } from "./autoRefreshPrefs";

beforeEach(() => window.localStorage.clear());

describe("autoRefreshPrefs", () => {
  it("defaults to off for an unknown tab", () => {
    expect(loadAutoRefresh("quote:AAPL")).toBe(false);
  });

  it("persists per tab and round-trips independently", () => {
    saveAutoRefresh("quote:AAPL", true);
    saveAutoRefresh("portfolio", true);
    expect(loadAutoRefresh("quote:AAPL")).toBe(true);
    expect(loadAutoRefresh("portfolio")).toBe(true);
    expect(loadAutoRefresh("quote:TSLA")).toBe(false);
  });

  it("turning off removes the entry", () => {
    saveAutoRefresh("quote:AAPL", true);
    saveAutoRefresh("quote:AAPL", false);
    expect(loadAutoRefresh("quote:AAPL")).toBe(false);
  });

  it("ignores corrupt storage", () => {
    window.localStorage.setItem("omphalos.autorefresh.v1", "{not json");
    expect(loadAutoRefresh("quote:AAPL")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/lib/autoRefreshPrefs.test.ts`
Expected: FAIL — cannot find module `./autoRefreshPrefs`.

- [ ] **Step 3: Write minimal implementation**

Create `web/app/lib/autoRefreshPrefs.ts`:

```ts
// Per-tab auto-refresh toggle, persisted to localStorage (non-secret UI state,
// CLAUDE.md). One JSON object keyed by tab id; defaults to off. Mirrors the
// appSettings/yieldPrefs persistence pattern.
const STORAGE_KEY = "omphalos.autorefresh.v1";

type Prefs = Record<string, boolean>;

function loadAll(): Prefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Prefs;
    return {};
  } catch {
    return {};
  }
}

export function loadAutoRefresh(tabId: string): boolean {
  return loadAll()[tabId] === true;
}

export function saveAutoRefresh(tabId: string, on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadAll();
    if (on) all[tabId] = true;
    else delete all[tabId];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/lib/autoRefreshPrefs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/autoRefreshPrefs.ts web/app/lib/autoRefreshPrefs.test.ts
git commit -m "feat(web): per-tab auto-refresh toggle persistence"
```

---

### Task 4: `useResource` — background refresh + controller wiring

**Files:**
- Modify: `web/app/lib/useResource.ts` (full rewrite below)

No unit test (React hook; see "Testing approach"). Verified by build + lint here and manual run in Task 9.

- [ ] **Step 1: Rewrite the hook**

Replace the entire contents of `web/app/lib/useResource.ts` with:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { createAutoRefreshController } from "./autoRefreshController";

// Generic on-demand fetch hook. Default behavior is snapshot/on-demand (load on
// open + explicit refresh). Passing `auto` opts a resource into bounded
// auto-refresh: a background timer that refetches without blanking the widget,
// paused when the tab is hidden, and auto-disabled on a degraded result.
// (CLAUDE.md rule 5.)
//
// `T` is the response envelope; widgets inspect `data.status` to render the
// source-down / unauthenticated / rate-limited / empty states. A transport
// failure (backend unreachable) surfaces as `transport_error`.
//
// Callers MUST memoize `load` (useCallback keyed on its inputs) so the resource
// refetches when inputs change and not on every render. `auto.isHealthy` and
// `auto.onAutoDisabled` must likewise be stable references.
export type ResourceState<T> =
  | { kind: "loading" }
  | { kind: "transport_error"; message: string }
  | { kind: "ok"; data: T };

export type AutoRefreshOptions<T> = {
  enabled: boolean;
  intervalMs: number;
  // Return false to auto-disable (e.g. a degraded source status). When omitted,
  // only a transport failure auto-disables.
  isHealthy?: (data: T) => boolean;
  onAutoDisabled?: (reason: string) => void;
};

export function useResource<T>(load: () => Promise<T>, auto?: AutoRefreshOptions<T>) {
  const [state, setState] = useState<ResourceState<T>>({ kind: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Manual / initial fetch: shows the full loading state.
  const run = useCallback(async () => {
    try {
      const data = await load();
      setState({ kind: "ok", data });
    } catch {
      setState({
        kind: "transport_error",
        message: "cannot reach backend (is the API running on :8000?)",
      });
    }
  }, [load]);

  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    void run();
  }, [run]);

  // Background (auto) fetch: keeps current data on screen; on a degraded result
  // or transport failure it signals auto-disable rather than blanking.
  const isHealthy = auto?.isHealthy;
  const onAutoDisabled = auto?.onAutoDisabled;
  const backgroundRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await load();
      setState({ kind: "ok", data });
      if (isHealthy && !isHealthy(data)) {
        onAutoDisabled?.("auto-refresh paused — source unavailable");
      }
    } catch {
      // Keep the last good snapshot visible; just stop auto-refreshing.
      onAutoDisabled?.("auto-refresh paused — cannot reach backend");
    } finally {
      setIsRefreshing(false);
    }
  }, [load, isHealthy, onAutoDisabled]);

  useEffect(() => {
    // Fetch the snapshot when the widget opens / its inputs change. setState
    // happens only after `await`, never synchronously; the lint rule can't see
    // past the call boundary, so it's suppressed here intentionally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  const enabled = auto?.enabled ?? false;
  const intervalMs = auto?.intervalMs ?? 0;
  useEffect(() => {
    if (!enabled || intervalMs <= 0 || typeof document === "undefined") return;
    const controller = createAutoRefreshController({
      intervalMs,
      onTick: () => void backgroundRefresh(),
    });
    const onVisibility = () => controller.setVisible(document.visibilityState === "visible");
    controller.setVisible(document.visibilityState === "visible");
    controller.start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.stop();
    };
  }, [enabled, intervalMs, backgroundRefresh]);

  return { state, refresh, isRefreshing };
}
```

- [ ] **Step 2: Verify build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: build succeeds (types OK), lint clean. Existing widgets still compile because `auto` is optional and the return now additionally includes `isRefreshing` (existing destructures of `{ state, refresh }` are unaffected).

- [ ] **Step 3: Commit**

```bash
git add web/app/lib/useResource.ts
git commit -m "feat(web): useResource background refresh + bounded auto-refresh wiring"
```

---

### Task 5: `useAutoRefreshToggle` — client hook over the prefs module

**Files:**
- Create: `web/app/lib/useAutoRefreshToggle.ts`

Thin glue (no unit test). Verified by build + lint.

- [ ] **Step 1: Create the hook**

Create `web/app/lib/useAutoRefreshToggle.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { loadAutoRefresh, saveAutoRefresh } from "./autoRefreshPrefs";

// Per-tab auto-refresh toggle backed by localStorage. Starts off (matching the
// SSR snapshot), then hydrates from storage on mount to avoid a server/client
// markup mismatch; persists on every change.
export function useAutoRefreshToggle(tabId: string) {
  const [on, setOnState] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnState(loadAutoRefresh(tabId));
  }, [tabId]);

  const setOn = useCallback(
    (next: boolean) => {
      setOnState(next);
      saveAutoRefresh(tabId, next);
    },
    [tabId],
  );

  return { on, setOn };
}
```

- [ ] **Step 2: Verify build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: build + lint clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/lib/useAutoRefreshToggle.ts
git commit -m "feat(web): useAutoRefreshToggle hook over persisted prefs"
```

---

### Task 6: `WidgetFrame` — auto toggle + "updating…" indicator

**Files:**
- Modify: `web/app/components/ui.tsx` (the `WidgetFrame` function only)

Presentational glue (no unit test, consistent with `ui.tsx`). Verified by build + lint.

- [ ] **Step 1: Add the `autoRefresh` prop and render the toggle**

In `web/app/components/ui.tsx`, replace the entire `WidgetFrame` function (currently starting at `export function WidgetFrame({`) with:

```tsx
// Standard widget chrome: title + source label + optional auto-refresh toggle +
// refresh button (on-demand only; auto-refresh is opt-in per CLAUDE.md rule 5).
export function WidgetFrame({
  title,
  source,
  onRefresh,
  busy,
  headerExtra,
  autoRefresh,
  children,
}: {
  title: string;
  source?: string;
  onRefresh: () => void;
  busy: boolean;
  headerExtra?: ReactNode;
  autoRefresh?: { on: boolean; onToggle: (on: boolean) => void; refreshing: boolean };
  children: ReactNode;
}) {
  return (
    <div style={{ padding: "1rem 1.25rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.85rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <strong style={{ fontSize: "1.05rem" }}>{title}</strong>
          {source && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>via {source}</span>}
          {autoRefresh?.on && autoRefresh.refreshing && (
            <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>updating…</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {headerExtra}
          {autoRefresh && (
            <button
              onClick={() => autoRefresh.onToggle(!autoRefresh.on)}
              title={autoRefresh.on ? "Auto-refresh on — click to turn off" : "Auto-refresh off — click to turn on"}
              aria-pressed={autoRefresh.on}
              style={{
                background: autoRefresh.on ? "var(--accent)" : "transparent",
                color: autoRefresh.on ? "var(--background)" : "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.3rem 0.7rem",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {autoRefresh.on ? "auto ●" : "auto ○"}
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={busy}
            style={{
              background: "transparent",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0.3rem 0.7rem",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {busy ? "…" : "refresh"}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `cd web && npm run build && npm run lint`
Expected: clean. (`ReactNode` is already imported at the top of `ui.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add web/app/components/ui.tsx
git commit -m "feat(web): WidgetFrame auto-refresh toggle + updating indicator"
```

---

### Task 7: Wire the four widgets + pass `tabId` from `WidgetHost`

**Files:**
- Modify: `web/app/components/WidgetHost.tsx` (4 cases)
- Modify: `web/app/widgets/QuoteWidget.tsx`
- Modify: `web/app/widgets/ChartWidget.tsx`
- Modify: `web/app/widgets/PortfolioWidget.tsx`
- Modify: `web/app/widgets/WatchlistWidget.tsx`

React glue (no unit test). Verified by build + lint and manual run in Task 9.

- [ ] **Step 1: Pass `tabId` to the four eligible widgets**

In `web/app/components/WidgetHost.tsx`, change the four eligible cases to pass `tabId={tab.id}` (leave all other cases untouched):

```tsx
    case "chart":
      return <ChartWidget symbol={tab.symbol!} tabId={tab.id} />;
    case "quote":
      return <QuoteWidget symbol={tab.symbol!} tabId={tab.id} />;
    case "portfolio":
      return <PortfolioWidget tabId={tab.id} />;
    case "watchlist":
      return <WatchlistWidget tabId={tab.id} />;
```

- [ ] **Step 2: Wire `QuoteWidget`**

In `web/app/widgets/QuoteWidget.tsx`, update the imports (add the two helpers and the hook) and the component signature/body. Replace lines 1–7 imports plus the `export default function QuoteWidget` declaration through the `useResource` call:

Add to the import block:

```tsx
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
```

Replace the function header (currently lines 36–42) with:

```tsx
export default function QuoteWidget({ symbol, tabId }: { symbol: string; tabId: string }) {
  const load = useCallback(() => loadQuoteData(symbol), [symbol]);
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("quote"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });
  const source = state.kind === "ok" ? state.data.quote?.source : undefined;

  return (
    <WidgetFrame
      title={`Quote · ${symbol}`}
      source={source}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
```

(Leave the `<ResourceView>…</ResourceView>` body and closing tags exactly as they are.)

- [ ] **Step 3: Wire `ChartWidget`**

In `web/app/widgets/ChartWidget.tsx`, add to the import block:

```tsx
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
```

Change the component signature line (currently line 13) to accept `tabId`:

```tsx
export default function ChartWidget({ symbol, tabId }: { symbol: string; tabId: string }) {
```

Replace the `useResource` call (currently line 24) with the toggle + auto wiring:

```tsx
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("chart"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });
```

Add the `autoRefresh` prop to the `<WidgetFrame …>` open tag (currently line 35), keeping its other props:

```tsx
    <WidgetFrame
      title={`Chart · ${symbol}`}
      source={source}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
```

- [ ] **Step 4: Wire `PortfolioWidget`**

In `web/app/widgets/PortfolioWidget.tsx`, add to the import block:

```tsx
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
```

Replace the function header (currently lines 12–17) with:

```tsx
export default function PortfolioWidget({ tabId }: { tabId: string }) {
  const load = useCallback(() => loadPortfolio(), []);
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("portfolio"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });

  return (
    <WidgetFrame
      title="Portfolio"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
```

(Leave the `<ResourceView>…` body unchanged.)

- [ ] **Step 5: Wire `WatchlistWidget`**

In `web/app/widgets/WatchlistWidget.tsx`, add to the import block:

```tsx
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
```

Replace the function header (currently lines 10–18, through the opening `<WidgetFrame …>` tag) with:

```tsx
export default function WatchlistWidget({ tabId }: { tabId: string }) {
  const { watchlist } = useTerminal();
  const key = watchlist.join(",");
  // Refetch whenever the set of watched symbols changes.
  const load = useCallback(() => loadWatchlist(watchlist), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("watchlist"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });

  return (
    <WidgetFrame
      title="Watchlist"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
```

(Leave the `<ResourceView>…` body unchanged.)

- [ ] **Step 6: Verify build + lint + unit tests**

Run: `cd web && npm run build && npm run lint && npm test`
Expected: build + lint clean; all unit tests pass (the new pure-module tests plus the existing suite).

- [ ] **Step 7: Commit**

```bash
git add web/app/components/WidgetHost.tsx web/app/widgets/QuoteWidget.tsx web/app/widgets/ChartWidget.tsx web/app/widgets/PortfolioWidget.tsx web/app/widgets/WatchlistWidget.tsx
git commit -m "feat(web): opt-in auto-refresh toggle on quote/watchlist/portfolio/chart"
```

---

### Task 8: Reword `CLAUDE.md` rule 5

**Files:**
- Modify: `CLAUDE.md` (hard rule 5)

- [ ] **Step 1: Replace rule 5**

In `CLAUDE.md`, under "## Hard rules (non-negotiable)", replace the rule 5 line:

```
5. Snapshot / on-demand only. No websockets or streaming. Data loads on widget
   open and on an explicit refresh.
```

with:

```
5. Snapshot / on-demand by default. No websockets or streaming. Data loads on
   widget open and on an explicit refresh. A widget MAY be opted into bounded
   auto-refresh via an off-by-default per-widget toggle (live-data widgets only:
   quote, watchlist, portfolio, chart), with a fixed interval ≥ the source's
   cache TTL, paused when the tab is hidden, and auto-disabled on
   source-down / rate-limited / unauthenticated / transport errors. Never refresh
   a source faster than its cache TTL; still no websockets or streaming.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rule 5 permits bounded opt-in widget auto-refresh"
```

---

### Task 9: Full verification + manual run

**Files:** none (verification only)

- [ ] **Step 1: Full automated gate**

Run: `cd web && npm test && npm run build && npm run lint`
Expected: all unit tests pass; build succeeds; lint clean.

- [ ] **Step 2: Manual run — observe auto-refresh end to end**

Start the worktree's servers (`./dev.sh` from the worktree root) and open the frontend. Then:

1. Run `quote AAPL` (or any symbol). Confirm the widget shows data and an `auto ○` button next to `refresh`.
2. Click `auto ○`. It should switch to `auto ●` (filled). Within ~15s you should see a brief "updating…" near the title and the values refresh **without** the widget blanking to "loading".
3. Reload the page. The quote tab should reopen with `auto ●` still on (persisted).
4. Switch to another browser tab for >15s, come back: it refreshes immediately on return (visibility resume), not on a stale timer.
5. Stop the backend (Ctrl-C the API) and wait one interval: the toggle should flip back to `auto ○` and the last good data stays on screen (auto-disable on transport error). Restart the backend; manual `refresh` works; re-enabling `auto` resumes.
6. Confirm non-eligible widgets (`news`, `yield`, `help`) show **no** auto toggle.

- [ ] **Step 3: Final confirmation**

If all of the above hold, the feature is complete. If any step fails, debug before considering the plan done. (No commit — Tasks 1–8 already committed the work.)

---

## Self-review notes

- **Spec coverage:** opt-in per-widget toggle (Tasks 5–7), fixed per-type intervals ≥ TTL (Task 1), eligibility = quote/watchlist/portfolio/chart (Tasks 1, 7), silent background refresh + `isRefreshing` (Tasks 4, 6), pause-when-hidden + immediate-on-resume (Task 2), auto-disable on degraded/transport (Tasks 1, 4, 7), localStorage persistence keyed per tab (Tasks 3, 5), rule 5 amendment (Task 8). All covered.
- **Type consistency:** `statusIsHealthy` (stable module ref) is passed as `isHealthy` to `useResource` by all four widgets; `AutoRefreshOptions<T>.isHealthy: (data: T) => boolean` accepts it because every loader envelope (`QuoteData`, `WatchlistData`, `ChartData`, `PortfolioResponse`) has `status: SourceStatus`. `autoRefreshMsFor` is called only with the four literal widget keys. `tabId: string` is threaded from `WidgetHost` (`tab.id`) into each widget and into `useAutoRefreshToggle`.
- **No placeholders:** every step contains the exact code/commands.
```
