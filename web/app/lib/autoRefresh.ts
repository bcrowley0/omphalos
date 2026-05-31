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
