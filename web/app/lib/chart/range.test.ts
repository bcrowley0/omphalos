import { describe, expect, it } from "vitest";
import { INTERVALS, SPANS, resolveRange, validIntervals } from "./range";

describe("resolveRange", () => {
  it("keeps the interval when it is valid for the span", () => {
    expect(resolveRange("1M", "1h")).toEqual({ span: "1M", interval: "1h" });
  });

  it("snaps the interval to the span default when the interval is invalid", () => {
    // 1m is too fine for a 1Y span -> snaps to that span's default (1d)
    expect(resolveRange("1Y", "1m")).toEqual({ span: "1Y", interval: "1d" });
  });

  it("snaps when moving from a fine span to a coarse one", () => {
    // was viewing 1D/5m, switch span to 5Y -> 5m invalid -> default 1w
    expect(resolveRange("5Y", "5m")).toEqual({ span: "5Y", interval: "1w" });
  });
});

describe("validIntervals", () => {
  it("returns the allowed intervals for a span (all within Kraken's 720-bar cap)", () => {
    expect(validIntervals("1D")).toEqual(["5m", "15m", "1h"]);
    expect(validIntervals("5Y")).toEqual(["1w"]);
  });

  it("every valid interval is a member of the full INTERVALS list", () => {
    for (const span of SPANS) {
      for (const iv of validIntervals(span)) {
        expect(INTERVALS).toContain(iv);
      }
    }
  });
});
