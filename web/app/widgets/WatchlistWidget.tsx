"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import { loadWatchlist } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";

export default function WatchlistWidget({ tabId }: { tabId: string }) {
  const { watchlist } = useTerminal();
  const key = watchlist.join(",");
  // Refetch whenever the set of watched symbols changes.
  const load = useCallback(() => loadWatchlist(watchlist), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("watchlist"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });

  return (
    <WidgetFrame
      title="Watchlist"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
      <ResourceView state={state}>
        {(data) =>
          data.quotes.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Watchlist is empty. Add with: <code>watch &lt;SYMBOL&gt;</code></p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Symbol</th>
                  <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Last</th>
                  <th style={{ textAlign: "right", color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" }}>Chg%</th>
                  <th style={{ padding: "0.3rem 0.6rem" }} />
                </tr>
              </thead>
              <tbody>
                {data.quotes.map((q) => (
                  <tr key={q.symbol} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.3rem 0.6rem" }}>
                      <button
                        onClick={() => terminalStore.dispatch(`chart ${q.symbol}`)}
                        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                        title="open chart"
                      >
                        {q.symbol}
                      </button>
                    </td>
                    <td style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>{fmt(q.last)}</td>
                    <td style={{ textAlign: "right", padding: "0.3rem 0.6rem", color: signColor(q.changePct) }}>{fmt(q.changePct)}%</td>
                    <td style={{ textAlign: "right", padding: "0.3rem 0.6rem" }}>
                      <button
                        onClick={() => terminalStore.dispatch(`unwatch ${q.symbol}`)}
                        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                        title="remove from watchlist"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
