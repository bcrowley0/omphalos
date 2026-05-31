"use client";
import { useCallback, useMemo, useState } from "react";
import { fmt, ResourceView, WidgetFrame, signColor } from "../components/ui";
import { loadYield } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { computeDeltaBp } from "../lib/yieldDelta";
import {
  type YieldPrefs,
  type CompareCurve,
  type ColorTheme,
  DEFAULT_YIELD_PREFS,
  compareKey,
  exactDates,
  toggleChart,
  toggleDelta,
  addExactDate,
  removeCompare,
  setColorTheme,
  loadYieldPrefs,
  saveYieldPrefs,
} from "../lib/yieldPrefs";
import { COLOR_THEMES, themeColors } from "../lib/yieldColors";
import type { Schemas, YieldPoint } from "../lib/api/client";

type AsOfCurve = Schemas["AsOfCurve"];

type RenderCurve = { key: string; label: string; color: string; points: YieldPoint[] };

// Multi-line SVG: x is tenor index (shared across curves via the union of tenor
// labels in current/widest curve); y is rate, normalized across all visible curves.
function CurveSvg({ curves, tenors }: { curves: RenderCurve[]; tenors: string[] }) {
  const W = 560;
  const H = 240;
  const pad = 36;
  const rates = curves.flatMap((c) => c.points.map((p) => p.ratePct));
  const min = rates.length ? Math.min(...rates) : 0;
  const max = rates.length ? Math.max(...rates) : 1;
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (tenors.length - 1 || 1);
  const y = (r: number) => H - pad - ((r - min) / span) * (H - 2 * pad);
  const idx = new Map(tenors.map((t, i) => [t, i]));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Treasury yield curves">
      {curves.map((c) => {
        const pts = c.points
          .filter((p) => idx.has(p.tenorLabel))
          .sort((a, b) => idx.get(a.tenorLabel)! - idx.get(b.tenorLabel)!);
        const path = pts
          .map((p, j) => `${j === 0 ? "M" : "L"} ${x(idx.get(p.tenorLabel)!).toFixed(1)} ${y(p.ratePct).toFixed(1)}`)
          .join(" ");
        return (
          <g key={c.key}>
            <path d={path} fill="none" stroke={c.color} strokeWidth={2} />
            {pts.map((p) => (
              <circle key={p.tenorLabel} cx={x(idx.get(p.tenorLabel)!)} cy={y(p.ratePct)} r={3} fill={c.color} />
            ))}
          </g>
        );
      })}
      {tenors.map((t, i) => (
        <text key={t} x={x(i)} y={H - pad + 16} fontSize={10} fill="var(--muted)" textAnchor="middle">
          {t}
        </text>
      ))}
    </svg>
  );
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

// Settings popover: per-compare Chart/Δ checkboxes + add-exact-date + reset.
function SettingsPopover({
  prefs,
  setPrefs,
  curvesByKey,
}: {
  prefs: YieldPrefs;
  setPrefs: (p: YieldPrefs) => void;
  curvesByKey: Map<string, AsOfCurve>;
}) {
  const [open, setOpen] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const cell: React.CSSProperties = { padding: "0.2rem 0.5rem", fontSize: "0.85rem" };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.3rem 0.7rem",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ⚙ curves
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.4rem)",
            zIndex: 10,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.6rem",
            minWidth: 240,
            boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                <th style={{ ...cell, textAlign: "left" }}>Curve</th>
                <th style={cell}>Chart</th>
                <th style={cell}>Δ</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={cell}>Today</td>
                <td style={{ ...cell, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={prefs.currentOnChart}
                    onChange={() => setPrefs({ ...prefs, currentOnChart: !prefs.currentOnChart })}
                  />
                </td>
                <td style={{ ...cell, textAlign: "center", color: "var(--muted)" }}>ref</td>
                <td style={cell} />
              </tr>
              {prefs.compares.map((c) => {
                const key = compareKey(c);
                const resolved = curvesByKey.get(key);
                return (
                  <tr key={key} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={cell}>
                      {c.kind === "relative" ? c.period.toUpperCase() : c.date}
                      {resolved && (
                        <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: "0.72rem" }}>
                          {fmtDate(resolved.obsDate)}
                        </span>
                      )}
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <input type="checkbox" checked={c.onChart} onChange={() => setPrefs(toggleChart(prefs, key))} />
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <input type="checkbox" checked={c.showDelta} onChange={() => setPrefs(toggleDelta(prefs, key))} />
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      {c.kind === "exact" && (
                        <button
                          onClick={() => setPrefs(removeCompare(prefs, key))}
                          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}
                          aria-label={`remove ${key}`}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.6rem" }}>
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.2rem 0.4rem",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => {
                if (dateInput) {
                  setPrefs(addExactDate(prefs, dateInput));
                  setDateInput("");
                }
              }}
              style={{
                background: "transparent",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.2rem 0.6rem",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              add
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.6rem", fontSize: "0.85rem" }}>
            <span style={{ color: "var(--muted)" }}>Colors</span>
            <select
              value={prefs.colorTheme}
              onChange={(e) => setPrefs(setColorTheme(prefs, e.target.value as ColorTheme))}
              style={{
                flex: 1,
                background: "var(--background)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.2rem 0.4rem",
                fontFamily: "inherit",
              }}
            >
              {(Object.keys(COLOR_THEMES) as ColorTheme[]).map((k) => (
                <option key={k} value={k}>
                  {COLOR_THEMES[k].label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setPrefs(DEFAULT_YIELD_PREFS)}
            style={{
              marginTop: "0.5rem",
              background: "transparent",
              color: "var(--muted)",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "0.8rem",
            }}
          >
            reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

export default function YieldWidget() {
  const [prefs, setPrefsState] = useState<YieldPrefs>(() => loadYieldPrefs());
  const setPrefs = useCallback((p: YieldPrefs) => {
    setPrefsState(p);
    saveYieldPrefs(p);
  }, []);

  const asof = exactDates(prefs);
  const asofKey = asof.join(",");
  const load = useCallback(() => loadYield(asof), [asofKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { state, refresh } = useResource(load);

  const settings = <SettingsPopoverWrapper prefs={prefs} setPrefs={setPrefs} state={state} />;

  return (
    <WidgetFrame
      title="Treasury Yield Curve"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
    >
      <ResourceView state={state}>
        {(data) => {
          const curves = data.curves ?? [];
          const byKey = new Map(curves.map((c) => [c.key, c]));
          const current = byKey.get("current");
          if (!current || current.points.length === 0) {
            return <p style={{ color: "var(--muted)" }}>No curve data.</p>;
          }
          const tenors = current.points.map((p) => p.tenorLabel);
          const theme = themeColors(prefs.colorTheme);

          // Chart curves: current (if on) + each compare with onChart, colored per theme.
          const chartCurves: RenderCurve[] = [];
          if (prefs.currentOnChart) {
            chartCurves.push({ key: "current", label: "Today", color: theme.current, points: current.points });
          }
          prefs.compares.forEach((c: CompareCurve, i) => {
            if (!c.onChart) return;
            const resolved = byKey.get(compareKey(c));
            if (resolved) {
              chartCurves.push({
                key: resolved.key,
                label: resolved.label,
                color: theme.palette[i % theme.palette.length],
                points: resolved.points,
              });
            }
          });

          // Δ columns: each compare with showDelta that resolved to a curve.
          const deltaCols = prefs.compares
            .filter((c) => c.showDelta)
            .map((c) => byKey.get(compareKey(c)))
            .filter((c): c is AsOfCurve => Boolean(c))
            .map((c) => ({ curve: c, deltas: computeDeltaBp(current.points, c.points) }));

          return (
            <div>
              <CurveSvg curves={chartCurves} tenors={tenors} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", margin: "0.4rem 0 0.6rem" }}>
                {chartCurves.map((c) => (
                  <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem" }}>
                    <span style={{ width: 12, height: 2, background: c.color, display: "inline-block" }} />
                    {c.label}
                    <span style={{ color: "var(--muted)" }}>{fmtDate(byKey.get(c.key)?.obsDate ?? 0)}</span>
                  </span>
                ))}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Tenor</th>
                    <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Rate %</th>
                    {deltaCols.map(({ curve }) => (
                      <th key={curve.key} style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>
                        Δ {curve.label}
                        <div style={{ fontSize: "0.7rem" }}>{fmtDate(curve.obsDate)} (bp)</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current.points.map((p) => (
                    <tr key={p.tenorLabel} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.3rem 0.6rem" }}>{p.tenorLabel}</td>
                      <td style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>{fmt(p.ratePct)}</td>
                      {deltaCols.map(({ curve, deltas }) => {
                        const d = deltas[p.tenorLabel];
                        return (
                          <td key={curve.key} style={{ textAlign: "right", padding: "0.3rem 0.6rem", color: theme.deltaSemantic ? signColor(d) : "var(--foreground)" }}>
                            {d === null || d === undefined ? "—" : `${d > 0 ? "+" : ""}${fmt(d, 1)}`}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </ResourceView>
    </WidgetFrame>
  );
}

// Wrapper so the popover can read resolved curves out of the resource state.
function SettingsPopoverWrapper({
  prefs,
  setPrefs,
  state,
}: {
  prefs: YieldPrefs;
  setPrefs: (p: YieldPrefs) => void;
  state: ReturnType<typeof useResource<Schemas["YieldCurveResponse"]>>["state"];
}) {
  const curvesByKey = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, AsOfCurve>();
    return new Map((state.data.curves ?? []).map((c) => [c.key, c]));
  }, [state]);
  return <SettingsPopover prefs={prefs} setPrefs={setPrefs} curvesByKey={curvesByKey} />;
}
