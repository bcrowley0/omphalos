"use client";

import { useCallback } from "react";
import { fmt, ResourceView, WidgetFrame } from "../components/ui";
import { loadYield } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import type { YieldPoint } from "../lib/api/client";

// Simple inline SVG line of rate vs tenor. The points are evenly spaced along x
// by index (tenor order) for readability; the y-axis is the rate. Lightweight
// Charts is time-axis oriented, so a small bespoke SVG is clearer for a curve.
function CurveSvg({ points }: { points: YieldPoint[] }) {
  const W = 560;
  const H = 240;
  const pad = 36;
  const rates = points.map((p) => p.ratePct);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (points.length - 1 || 1);
  const y = (r: number) => H - pad - ((r - min) / span) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.ratePct).toFixed(1)}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Treasury yield curve">
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((p, i) => (
        <g key={p.tenorLabel}>
          <circle cx={x(i)} cy={y(p.ratePct)} r={3} fill="var(--accent)" />
          <text x={x(i)} y={H - pad + 16} fontSize={10} fill="var(--muted)" textAnchor="middle">
            {p.tenorLabel}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function YieldWidget() {
  const load = useCallback(() => loadYield(), []);
  const { state, refresh } = useResource(load);

  return (
    <WidgetFrame title="Treasury Yield Curve" onRefresh={refresh} busy={state.kind === "loading"}>
      <ResourceView state={state}>
        {(data) =>
          data.points.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No curve data.</p>
          ) : (
            <div>
              <CurveSvg points={data.points} />
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>
                      Tenor
                    </th>
                    <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>
                      Rate %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p) => (
                    <tr key={p.tenorLabel} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.3rem 0.6rem" }}>{p.tenorLabel}</td>
                      <td style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>{fmt(p.ratePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
