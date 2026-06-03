import { describe, expect, it } from "vitest";
import { PERIOD_ORDER, periodCells, dayStatRows, rangeRows } from "./quoteView";
import type { Schemas } from "./api/client";

type Quote = Schemas["Quote"];

function q(extra: Partial<Quote>): Quote {
  return { symbol: "X", source: "mock", stale: false, ...extra } as Quote;
}

describe("periodCells", () => {
  it("returns all periods in order, filling missing with null", () => {
    const cells = periodCells([{ period: "1M", changePct: 2.5 }] as Schemas["PeriodChange"][]);
    expect(cells.map((c) => c.period)).toEqual([...PERIOD_ORDER]);
    expect(cells.find((c) => c.period === "1M")!.pct).toBe(2.5);
    expect(cells.find((c) => c.period === "1Y")!.pct).toBeNull();
  });
  it("treats undefined input as all-null", () => {
    expect(periodCells(undefined).every((c) => c.pct === null)).toBe(true);
  });
});

describe("dayStatRows", () => {
  it("hides rows whose value is null/undefined", () => {
    const rows = dayStatRows(q({ dayOpen: 10, dayHigh: 12, volume: null, vwap: 11 }));
    expect(rows.map((r) => r.label)).toEqual(["open", "high", "vwap"]);
  });
});

describe("rangeRows", () => {
  it("shows only present fundamentals (market cap only when set)", () => {
    expect(rangeRows(q({ week52High: 100 })).map((r) => r.label)).toEqual(["52w high"]);
    expect(rangeRows(q({ marketCap: 5 })).map((r) => r.label)).toEqual(["mkt cap"]);
    expect(rangeRows(q({})).length).toBe(0);
  });
});
