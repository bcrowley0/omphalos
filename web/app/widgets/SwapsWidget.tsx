"use client";
import { WidgetFrame, ResourceView, fmt } from "../components/ui";
import { loadSwaps } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import type { Schemas } from "../lib/api/client";

type SwapCurve = Schemas["SwapCurve"];

const th: React.CSSProperties = { textAlign: "left", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const thr: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "0.3rem 0.6rem" };
const tdr: React.CSSProperties = { ...td, textAlign: "right" };

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtNotional(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  return `$${n.toLocaleString()}`;
}

function CurveTable({ curve }: { curve: SwapCurve }) {
  return (
    <div style={{ marginBottom: "1.2rem" }}>
      <strong>{curve.label}</strong>
      {curve.points.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: "0.3rem 0" }}>No prints in this file.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.4rem" }}>
          <thead>
            <tr>
              <th style={th}>Tenor</th>
              <th style={thr}>Rate %</th>
              <th style={thr}>Trades</th>
              <th style={thr}>Notional</th>
            </tr>
          </thead>
          <tbody>
            {curve.points.map((p) => (
              <tr key={p.tenorLabel} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{p.tenorLabel}</td>
                <td style={tdr}>{fmt(p.ratePct)}</td>
                <td style={tdr}>{p.tradeCount}</td>
                <td style={tdr}>{fmtNotional(p.totalNotional)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SwapsWidget() {
  const { state, refresh } = useResource(loadSwaps);
  return (
    <WidgetFrame
      title="Swaps"
      source="CFTC SDR (DTCC)"
      onRefresh={refresh}
      busy={state.kind === "loading"}
    >
      <ResourceView state={state}>
        {(data) => (
          <div>
            <p style={{ color: "var(--muted)", fontSize: "0.8rem", margin: "0 0 0.9rem" }}>
              EOD file {fmtDate(data.fileDate)} · median fixed rate per tenor from anonymized,
              capped SDR prints — not a benchmark rate.
            </p>
            {(data.curves ?? []).map((c) => (
              <CurveTable key={c.key} curve={c} />
            ))}
          </div>
        )}
      </ResourceView>
    </WidgetFrame>
  );
}
