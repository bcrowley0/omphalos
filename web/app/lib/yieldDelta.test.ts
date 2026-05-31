import { describe, expect, it } from "vitest";
import { computeDeltaBp } from "./yieldDelta";
import type { YieldPoint } from "./api/client";

const p = (tenorLabel: string, ratePct: number): YieldPoint => ({
  tenorLabel,
  tenorYears: 0,
  ratePct,
  obsDate: 0,
});

describe("computeDeltaBp", () => {
  it("returns signed basis points = (current - comparison) * 100", () => {
    const out = computeDeltaBp([p("2Y", 4.50), p("10Y", 4.30)], [p("2Y", 4.40), p("10Y", 4.45)]);
    expect(out["2Y"]).toBe(10); // +0.10% = +10bp
    expect(out["10Y"]).toBe(-15); // -0.15% = -15bp
  });

  it("yields null when a tenor is missing on the comparison side", () => {
    const out = computeDeltaBp([p("2Y", 4.50), p("30Y", 4.70)], [p("2Y", 4.40)]);
    expect(out["2Y"]).toBe(10);
    expect(out["30Y"]).toBeNull();
  });
});
