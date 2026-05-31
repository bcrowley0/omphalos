"use client";

import { INTERVALS, SPANS, validIntervals } from "../lib/chart/range";
import type { Interval, Span } from "../lib/chart/range";

// Two presentational button rows: chart span (lookback) and candle interval.
// Pure — props in, callbacks out. Invalid intervals for the current span render
// disabled (validity comes from the tested resolveRange/validIntervals logic).
export default function ChartControls({
  span,
  interval,
  onSpanChange,
  onIntervalChange,
}: {
  span: Span;
  interval: Interval;
  onSpanChange: (s: Span) => void;
  onIntervalChange: (i: Interval) => void;
}) {
  const allowed = validIntervals(span);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
      <Row label="Span">
        {SPANS.map((s) => (
          <Pill key={s} active={s === span} onClick={() => onSpanChange(s)}>
            {s}
          </Pill>
        ))}
      </Row>
      <Row label="Bar">
        {INTERVALS.map((i) => (
          <Pill
            key={i}
            active={i === interval}
            disabled={!allowed.includes(i)}
            onClick={() => onIntervalChange(i)}
          >
            {i}
          </Pill>
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ color: "var(--muted)", fontSize: "0.7rem", width: "2.5rem" }}>{label}</span>
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Pill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#0b0e14" : disabled ? "var(--border)" : "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "0.18rem 0.55rem",
        fontSize: "0.78rem",
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
