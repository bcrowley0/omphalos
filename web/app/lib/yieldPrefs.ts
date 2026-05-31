// Per-widget UI prefs for the yield curve: which comparison curves are drawn on
// the chart and which Δ columns show. Persisted to localStorage (non-secret UI
// state, CLAUDE.md). Mutators are pure; load/save are the only impure parts.

export type ComparePeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

export type CompareCurve =
  | { kind: "relative"; period: ComparePeriod; onChart: boolean; showDelta: boolean }
  | { kind: "exact"; date: string; onChart: boolean; showDelta: boolean };

export type YieldPrefs = {
  currentOnChart: boolean;
  compares: CompareCurve[];
};

export function compareKey(c: CompareCurve): string {
  return c.kind === "relative" ? c.period : c.date;
}

// Default: chart shows current + 1w; all six relative Δ columns shown.
export const DEFAULT_YIELD_PREFS: YieldPrefs = {
  currentOnChart: true,
  compares: [
    { kind: "relative", period: "1w", onChart: true, showDelta: true },
    { kind: "relative", period: "1d", onChart: false, showDelta: true },
    { kind: "relative", period: "1m", onChart: false, showDelta: true },
    { kind: "relative", period: "3m", onChart: false, showDelta: true },
    { kind: "relative", period: "6m", onChart: false, showDelta: true },
    { kind: "relative", period: "1y", onChart: false, showDelta: true },
  ],
};

function mapCompare(prefs: YieldPrefs, key: string, fn: (c: CompareCurve) => CompareCurve): YieldPrefs {
  return { ...prefs, compares: prefs.compares.map((c) => (compareKey(c) === key ? fn(c) : c)) };
}

export function toggleChart(prefs: YieldPrefs, key: string): YieldPrefs {
  return mapCompare(prefs, key, (c) => ({ ...c, onChart: !c.onChart }));
}

export function toggleDelta(prefs: YieldPrefs, key: string): YieldPrefs {
  return mapCompare(prefs, key, (c) => ({ ...c, showDelta: !c.showDelta }));
}

export function addExactDate(prefs: YieldPrefs, date: string): YieldPrefs {
  if (prefs.compares.some((c) => compareKey(c) === date)) return prefs;
  return {
    ...prefs,
    compares: [...prefs.compares, { kind: "exact", date, onChart: true, showDelta: true }],
  };
}

export function removeCompare(prefs: YieldPrefs, key: string): YieldPrefs {
  return { ...prefs, compares: prefs.compares.filter((c) => compareKey(c) !== key) };
}

// Exact dates to send as `asof` query params (relative curves need no param).
export function exactDates(prefs: YieldPrefs): string[] {
  return prefs.compares
    .filter((c): c is Extract<CompareCurve, { kind: "exact" }> => c.kind === "exact")
    .map((c) => c.date);
}

const STORAGE_KEY = "omphalos.yield.prefs.v1";

export function loadYieldPrefs(): YieldPrefs {
  if (typeof window === "undefined") return DEFAULT_YIELD_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_YIELD_PREFS;
    const parsed = JSON.parse(raw) as Partial<YieldPrefs>;
    if (!Array.isArray(parsed.compares)) return DEFAULT_YIELD_PREFS;
    return {
      currentOnChart: typeof parsed.currentOnChart === "boolean" ? parsed.currentOnChart : true,
      compares: parsed.compares as CompareCurve[],
    };
  } catch {
    return DEFAULT_YIELD_PREFS;
  }
}

export function saveYieldPrefs(prefs: YieldPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}
