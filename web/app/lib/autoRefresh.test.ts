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
