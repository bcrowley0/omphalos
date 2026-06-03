import { describe, expect, it } from "vitest";
import {
  coerceChartPrefs,
  coerceFollowingPrefs,
  coercePortfolioPrefs,
  coerceQuotePrefs,
  coerceWatchlistPrefs,
  DEFAULT_CHART_PREFS,
  DEFAULT_FOLLOWING_PREFS,
  DEFAULT_PORTFOLIO_PREFS,
  DEFAULT_QUOTE_PREFS,
  DEFAULT_WATCHLIST_PREFS,
} from "./widgetSettings";

describe("quote prefs", () => {
  it("defaults the new toggles to true", () => {
    expect(DEFAULT_QUOTE_PREFS.showPeriods).toBe(true);
    expect(DEFAULT_QUOTE_PREFS.showDayStats).toBe(true);
  });
  it("coerces partial / bad input to defaults", () => {
    expect(coerceQuotePrefs({ showPeriods: false }).showPeriods).toBe(false);
    expect(coerceQuotePrefs({ showPeriods: "nope" }).showPeriods).toBe(true);
    expect(coerceQuotePrefs({}).showDayStats).toBe(true);
  });
});

describe("widgetSettings coercers", () => {
  it("return defaults for empty / non-object input", () => {
    expect(coerceQuotePrefs(null)).toEqual(DEFAULT_QUOTE_PREFS);
    expect(coercePortfolioPrefs("x")).toEqual(DEFAULT_PORTFOLIO_PREFS);
    expect(coerceWatchlistPrefs(42)).toEqual(DEFAULT_WATCHLIST_PREFS);
    expect(coerceChartPrefs(undefined)).toEqual(DEFAULT_CHART_PREFS);
    expect(coerceFollowingPrefs(null)).toEqual(DEFAULT_FOLLOWING_PREFS);
  });

  it("preserve valid fields", () => {
    expect(coerceQuotePrefs({ showSource: false, showStale: false })).toEqual({
      showSource: false,
      showStale: false,
      showPeriods: true,
      showDayStats: true,
    });
    expect(coerceFollowingPrefs({ curated: false })).toEqual({ curated: false });
  });

  it("fill missing toggles with defaults", () => {
    expect(coercePortfolioPrefs({ showPositions: false })).toEqual({
      showPositions: false,
      showBalances: true,
    });
    expect(coerceWatchlistPrefs({ showBid: true })).toEqual({
      showLast: true,
      showChgPct: true,
      showBid: true,
      showAsk: false,
    });
    expect(coerceChartPrefs({ showSource: false })).toEqual({ showSource: false });
  });
});
