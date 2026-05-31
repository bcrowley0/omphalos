import type { YieldPoint } from "./api/client";

// Per-tenor basis-point change of the current curve vs a comparison curve:
// (currentRatePct - comparisonRatePct) * 100, rounded to 0.1bp. Aligned by
// tenorLabel; null where the tenor is absent on either side. Pure/testable.
export function computeDeltaBp(
  current: YieldPoint[],
  comparison: YieldPoint[],
): Record<string, number | null> {
  const past = new Map(comparison.map((c) => [c.tenorLabel, c.ratePct]));
  const out: Record<string, number | null> = {};
  for (const cur of current) {
    const prior = past.get(cur.tenorLabel);
    out[cur.tenorLabel] =
      prior === undefined ? null : Math.round((cur.ratePct - prior) * 100 * 10) / 10;
  }
  return out;
}
