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
