// Per-widget UI prefs for the yield curve: which comparison curves are drawn on
// the chart and which Δ columns show. Persisted to localStorage (non-secret UI
// state, CLAUDE.md). Mutators are pure; load/save are the only impure parts.

export type ComparePeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

export type CompareCurve =
  | { kind: "relative"; period: ComparePeriod; onChart: boolean; showDelta: boolean }
  | { kind: "exact"; date: string; onChart: boolean; showDelta: boolean };

// Overlay color scheme (config lives in yieldColors.ts; the keys are the contract).
export type ColorTheme = "vivid" | "blue" | "gray" | "gray-fn";
const COLOR_THEME_KEYS: ColorTheme[] = ["vivid", "blue", "gray", "gray-fn"];

function isColorTheme(x: unknown): x is ColorTheme {
  return typeof x === "string" && (COLOR_THEME_KEYS as string[]).includes(x);
}

export type YieldPrefs = {
  currentOnChart: boolean;
  compares: CompareCurve[];
  colorTheme: ColorTheme;
};

export function compareKey(c: CompareCurve): string {
  return c.kind === "relative" ? c.period : c.date;
}

export function setColorTheme(prefs: YieldPrefs, colorTheme: ColorTheme): YieldPrefs {
  return { ...prefs, colorTheme };
}

// Canonical shortest → longest lookback ordering for relative curves.
const PERIOD_ORDER: ComparePeriod[] = ["1d", "1w", "1m", "3m", "6m", "1y"];

function isComparePeriod(x: unknown): x is ComparePeriod {
  return typeof x === "string" && (PERIOD_ORDER as string[]).includes(x);
}

// Runtime shape check for a persisted compare curve (localStorage is untrusted).
function isCompareCurve(x: unknown): x is CompareCurve {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Record<string, unknown>;
  if (typeof c.onChart !== "boolean" || typeof c.showDelta !== "boolean") return false;
  if (c.kind === "relative") return isComparePeriod(c.period);
  if (c.kind === "exact") return typeof c.date === "string";
  return false;
}

// Sort relative curves into logical low-to-high order; keep exact-date curves
// after them in their existing (insertion) order.
function sortCompares(compares: CompareCurve[]): CompareCurve[] {
  const rel = compares
    .filter((c): c is Extract<CompareCurve, { kind: "relative" }> => c.kind === "relative")
    .sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period));
  const exact = compares.filter((c) => c.kind === "exact");
  return [...rel, ...exact];
}

// Default: chart shows current + 1w; all six relative Δ columns shown.
// Relative curves are ordered shortest → longest lookback (1d, 1w, 1m, …) so the
// settings popover and Δ columns read in logical low-to-high order.
export const DEFAULT_YIELD_PREFS: YieldPrefs = {
  currentOnChart: true,
  compares: [
    { kind: "relative", period: "1d", onChart: false, showDelta: true },
    { kind: "relative", period: "1w", onChart: true, showDelta: true },
    { kind: "relative", period: "1m", onChart: false, showDelta: true },
    { kind: "relative", period: "3m", onChart: false, showDelta: true },
    { kind: "relative", period: "6m", onChart: false, showDelta: true },
    { kind: "relative", period: "1y", onChart: false, showDelta: true },
  ],
  colorTheme: "vivid",
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

export const YIELD_PREFS_KEY = "omphalos.yield.prefs.v1";

// Pure: validate untrusted parsed JSON into a YieldPrefs (localStorage is untrusted).
export function coerceYieldPrefs(parsed: unknown): YieldPrefs {
  const p = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Partial<YieldPrefs>;
  if (!Array.isArray(p.compares)) return DEFAULT_YIELD_PREFS;
  return {
    currentOnChart: typeof p.currentOnChart === "boolean" ? p.currentOnChart : true,
    compares: sortCompares(p.compares.filter(isCompareCurve)),
    colorTheme: isColorTheme(p.colorTheme) ? p.colorTheme : "vivid",
  };
}

