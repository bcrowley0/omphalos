import type { Schemas } from "./api/client";

// Display order of the multi-period change ladder (mirrors the backend).
export const PERIOD_ORDER = ["1D", "1W", "1M", "3M", "YTD", "1Y", "5Y"] as const;

export type PeriodCell = { period: string; pct: number | null };

// Project the backend ladder onto the fixed display order; missing/None -> null.
export function periodCells(changes: Schemas["PeriodChange"][] | undefined): PeriodCell[] {
  const byPeriod = new Map((changes ?? []).map((c) => [c.period, c.changePct ?? null]));
  return PERIOD_ORDER.map((period) => ({
    period,
    pct: byPeriod.has(period) ? byPeriod.get(period)! : null,
  }));
}

export type StatRow = { label: string; value: number };

function present(rows: { label: string; value: number | null | undefined }[]): StatRow[] {
  return rows.filter((r): r is StatRow => r.value !== null && r.value !== undefined);
}

// Day stats — each row hidden when its value is absent (graceful missing fields).
export function dayStatRows(q: Schemas["Quote"]): StatRow[] {
  return present([
    { label: "open", value: q.dayOpen },
    { label: "high", value: q.dayHigh },
    { label: "low", value: q.dayLow },
    { label: "volume", value: q.volume },
    { label: "vwap", value: q.vwap },
  ]);
}

// Range / fundamentals — shown only when present (crypto omits these).
export function rangeRows(q: Schemas["Quote"]): StatRow[] {
  return present([
    { label: "52w high", value: q.week52High },
    { label: "52w low", value: q.week52Low },
    { label: "mkt cap", value: q.marketCap },
  ]);
}
