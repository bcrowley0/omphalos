import type { Schemas } from "../api/client";

// Span/Interval are owned by the backend Pydantic enums (CLAUDE.md type
// contract); we only reference the generated types here, never redefine them.
export type Span = Schemas["Span"];
export type Interval = Schemas["Interval"];

// Display order for the two button rows.
export const SPANS: Span[] = ["1D", "5D", "1M", "3M", "1Y", "5Y"];
export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

// Which intervals are sensible for each span. CRITICAL INVARIANT: every (span,
// interval) pair here must satisfy span/interval <= 720 bars, because Kraken's
// OHLC endpoint returns at most 720 candles and silently truncates beyond that.
// (e.g. 1M/15m = 2880 bars would show only the last ~7 days, not a month.) The
// finest interval is therefore dropped from each span. Matches Bloomberg/
// TradingView muscle memory while keeping every request inside the cap.
const VALID: Record<Span, Interval[]> = {
  "1D": ["5m", "15m", "1h"],
  "5D": ["15m", "1h", "4h"],
  "1M": ["1h", "4h", "1d"],
  "3M": ["4h", "1d", "1w"],
  "1Y": ["1d", "1w"],
  "5Y": ["1w"],
};

// The interval a span snaps to when the current interval is invalid for it.
const DEFAULT_INTERVAL: Record<Span, Interval> = {
  "1D": "5m",
  "5D": "15m",
  "1M": "1h",
  "3M": "4h",
  "1Y": "1d",
  "5Y": "1w",
};

export function validIntervals(span: Span): Interval[] {
  return VALID[span];
}

// Pure: given a desired (span, interval), return a valid pair. The span is
// always honored; the interval is kept if valid for that span, otherwise snapped
// to the span's default.
export function resolveRange(span: Span, interval: Interval): { span: Span; interval: Interval } {
  const valid = VALID[span];
  return { span, interval: valid.includes(interval) ? interval : DEFAULT_INTERVAL[span] };
}
