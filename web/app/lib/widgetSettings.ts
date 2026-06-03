// Per-widget UI display prefs for the simple widgets (Quote, Portfolio,
// Watchlist, Chart, Following). Non-secret UI state persisted via useWidgetPrefs.
// Auto-refresh is handled separately (see autoRefresh.ts / useAutoRefreshToggle.ts).
// Yield has its own richer shape in yieldPrefs.ts. All coercers are pure.

function asObject(x: unknown): Record<string, unknown> {
  return typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {};
}
function bool(x: unknown, fallback: boolean): boolean {
  return typeof x === "boolean" ? x : fallback;
}

// ---- Quote ----------------------------------------------------------------
export const QUOTE_PREFS_KEY = "omphalos.quote.prefs.v1";
export type QuotePrefs = {
  showSource: boolean;
  showStale: boolean;
  showPeriods: boolean;
  showDayStats: boolean;
};
export const DEFAULT_QUOTE_PREFS: QuotePrefs = {
  showSource: true,
  showStale: true,
  showPeriods: true,
  showDayStats: true,
};
export function coerceQuotePrefs(x: unknown): QuotePrefs {
  const p = asObject(x);
  return {
    showSource: bool(p.showSource, true),
    showStale: bool(p.showStale, true),
    showPeriods: bool(p.showPeriods, true),
    showDayStats: bool(p.showDayStats, true),
  };
}

// ---- Portfolio ------------------------------------------------------------
export const PORTFOLIO_PREFS_KEY = "omphalos.portfolio.prefs.v1";
export type PortfolioPrefs = { showPositions: boolean; showBalances: boolean };
export const DEFAULT_PORTFOLIO_PREFS: PortfolioPrefs = { showPositions: true, showBalances: true };
export function coercePortfolioPrefs(x: unknown): PortfolioPrefs {
  const p = asObject(x);
  return {
    showPositions: bool(p.showPositions, true),
    showBalances: bool(p.showBalances, true),
  };
}

// ---- Watchlist ------------------------------------------------------------
export const WATCHLIST_PREFS_KEY = "omphalos.watchlist.prefs.v1";
export type WatchlistPrefs = {
  showLast: boolean;
  showChgPct: boolean;
  showBid: boolean;
  showAsk: boolean;
};
export const DEFAULT_WATCHLIST_PREFS: WatchlistPrefs = {
  showLast: true,
  showChgPct: true,
  showBid: false,
  showAsk: false,
};
export function coerceWatchlistPrefs(x: unknown): WatchlistPrefs {
  const p = asObject(x);
  return {
    showLast: bool(p.showLast, true),
    showChgPct: bool(p.showChgPct, true),
    showBid: bool(p.showBid, false),
    showAsk: bool(p.showAsk, false),
  };
}

// ---- Chart ----------------------------------------------------------------
export const CHART_PREFS_KEY = "omphalos.chart.prefs.v1";
export type ChartPrefs = { showSource: boolean };
export const DEFAULT_CHART_PREFS: ChartPrefs = { showSource: true };
export function coerceChartPrefs(x: unknown): ChartPrefs {
  const p = asObject(x);
  return { showSource: bool(p.showSource, true) };
}

// ---- Following ------------------------------------------------------------
export const FOLLOWING_PREFS_KEY = "omphalos.following.prefs.v1";
export type FollowingPrefs = { curated: boolean };
export const DEFAULT_FOLLOWING_PREFS: FollowingPrefs = { curated: true };
export function coerceFollowingPrefs(x: unknown): FollowingPrefs {
  const p = asObject(x);
  return { curated: bool(p.curated, true) };
}
