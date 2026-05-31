"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import { loadPortfolio } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useIbkrAuth } from "../components/IbkrAuthProvider";
import { IbkrLoginButton } from "../components/IbkrLoginButton";

const th: React.CSSProperties = { textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const td: React.CSSProperties = { textAlign: "right", padding: "0.3rem 0.6rem" };
const tdl: React.CSSProperties = { ...td, textAlign: "left" };

export default function PortfolioWidget({ tabId }: { tabId: string }) {
  const load = useCallback(() => loadPortfolio(), []);
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("portfolio"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });
  const ibkr = useIbkrAuth();
  // The portfolio merges IBKR positions + Kraken balances; only offer the gateway
  // login when the unauthenticated state actually came from IBKR (its message is
  // prefixed "positions: …" and names the IBKR gateway).
  const ibkrNeedsLogin =
    state.kind === "ok" &&
    state.data.status === "unauthenticated" &&
    Boolean(state.data.message && state.data.message.includes("IBKR"));

  return (
    <WidgetFrame
      title="Portfolio"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
      <ResourceView state={state}>
        {(data) => (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <section>
              <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                POSITIONS (IBKR + Kraken margin)
              </h3>
              {data.positions.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No positions.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                      <th style={{ ...th, textAlign: "left" }}>Side</th>
                      <th style={th}>Qty</th>
                      <th style={th}>Avg Cost</th>
                      <th style={th}>Mkt Value</th>
                      <th style={th}>Margin</th>
                      <th style={th}>Unrl P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={`${p.source}:${p.symbol}:${p.side ?? ""}`} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={tdl}>{p.symbol}</td>
                        <td style={tdl}>{p.side ?? "—"}</td>
                        <td style={td}>{fmt(p.qty, 0)}</td>
                        <td style={td}>{fmt(p.avgCost)}</td>
                        <td style={td}>{fmt(p.marketValue)}</td>
                        <td style={td}>{fmt(p.marginUsed)}</td>
                        <td style={{ ...td, color: signColor(p.unrealizedPnl) }}>{fmt(p.unrealizedPnl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section>
              <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                BALANCES (Kraken)
              </h3>
              {data.balances.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>No balances.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>Asset</th>
                      <th style={th}>Total</th>
                      <th style={th}>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.balances.map((b) => (
                      <tr key={b.asset} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={tdl}>{b.asset}</td>
                        <td style={td}>{fmt(b.total, 4)}</td>
                        <td style={td}>{fmt(b.available, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {data.marginSummary && (
              <section>
                <h3 style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                  MARGIN SUMMARY (Kraken)
                </h3>
                <table style={{ borderCollapse: "collapse" }}>
                  <tbody>
                    {([
                      ["Equity", fmt(data.marginSummary.equity)],
                      ["Used Margin", fmt(data.marginSummary.usedMargin)],
                      ["Free Margin", fmt(data.marginSummary.freeMargin)],
                      ["Margin Level %", fmt(data.marginSummary.marginLevel)],
                      ["Unrealized P&L", fmt(data.marginSummary.unrealizedPnl)],
                      ["Cost Basis", fmt(data.marginSummary.costBasis)],
                      ["Valuation", fmt(data.marginSummary.valuation)],
                    ] as const).map(([label, value]) => (
                      <tr key={label} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ ...tdl, color: "var(--muted)" }}>{label}</td>
                        <td style={td}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        )}
      </ResourceView>
      {ibkrNeedsLogin && (
        <div style={{ marginTop: "0.8rem" }}>
          <IbkrLoginButton loginUrl={ibkr.loginUrl} />
        </div>
      )}
    </WidgetFrame>
  );
}
