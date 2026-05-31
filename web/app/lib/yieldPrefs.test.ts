import { describe, expect, it } from "vitest";
import {
  DEFAULT_YIELD_PREFS,
  compareKey,
  exactDates,
  toggleChart,
  toggleDelta,
  addExactDate,
  removeCompare,
} from "./yieldPrefs";

describe("yieldPrefs", () => {
  it("default: current + 1w on chart, all six relative deltas shown", () => {
    expect(DEFAULT_YIELD_PREFS.currentOnChart).toBe(true);
    const onChart = DEFAULT_YIELD_PREFS.compares.filter((c) => c.onChart).map(compareKey);
    expect(onChart).toEqual(["1w"]);
    const deltas = DEFAULT_YIELD_PREFS.compares.filter((c) => c.showDelta).map(compareKey);
    expect(deltas).toEqual(["1d", "1w", "1m", "3m", "6m", "1y"]);
  });

  it("toggleChart / toggleDelta flip the matching compare by key", () => {
    let prefs = toggleChart(DEFAULT_YIELD_PREFS, "1d");
    expect(prefs.compares.find((c) => compareKey(c) === "1d")?.onChart).toBe(true);
    prefs = toggleDelta(prefs, "1w");
    expect(prefs.compares.find((c) => compareKey(c) === "1w")?.showDelta).toBe(false);
  });

  it("addExactDate appends an exact compare (both toggles on); dedupes", () => {
    let prefs = addExactDate(DEFAULT_YIELD_PREFS, "2024-06-06");
    const added = prefs.compares.find((c) => compareKey(c) === "2024-06-06");
    expect(added).toMatchObject({ kind: "exact", date: "2024-06-06", onChart: true, showDelta: true });
    prefs = addExactDate(prefs, "2024-06-06"); // no duplicate
    expect(prefs.compares.filter((c) => compareKey(c) === "2024-06-06")).toHaveLength(1);
    expect(exactDates(prefs)).toEqual(["2024-06-06"]);
  });

  it("removeCompare drops the matching compare", () => {
    const prefs = removeCompare(DEFAULT_YIELD_PREFS, "1y");
    expect(prefs.compares.find((c) => compareKey(c) === "1y")).toBeUndefined();
  });
});
