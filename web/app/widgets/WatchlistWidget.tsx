"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { ToggleRow } from "../components/WidgetSettingsMenu";
import { loadWatchlist } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useTerminal } from "../lib/useTerminal";
import { terminalStore } from "../lib/store";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { coerceWatchlistPrefs, DEFAULT_WATCHLIST_PREFS, WATCHLIST_PREFS_KEY } from "../lib/widgetSettings";

const th: React.CSSProperties = { color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const num: React.CSSProperties = { textAlign: "right", padding: "0.3rem 0.6rem" };

export default function WatchlistWidget({ tabId }: { tabId: string }) {
  const { watchlist } = useTerminal();
  const key = watchlist.join(",");
  const [prefs, setPrefs] = useWidgetPrefs(WATCHLIST_PREFS_KEY, DEFAULT_WATCHLIST_PREFS, coerceWatchlistPrefs);
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

  const settings = (
    <WidgetSettingsMenu title="watchlist settings">
      <ToggleRow label="Last" checked={prefs.showLast} onChange={() => setPrefs({ ...prefs, showLast: !prefs.showLast })} />
      <ToggleRow label="Chg %" checked={prefs.showChgPct} onChange={() => setPrefs({ ...prefs, showChgPct: !prefs.showChgPct })} />
      <ToggleRow label="Bid" checked={prefs.showBid} onChange={() => setPrefs({ ...prefs, showBid: !prefs.showBid })} />
      <ToggleRow label="Ask" checked={prefs.showAsk} onChange={() => setPrefs({ ...prefs, showAsk: !prefs.showAsk })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title="Watchlist"
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
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
                  <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                  {prefs.showLast && <th style={{ ...th, textAlign: "right" }}>Last</th>}
                  {prefs.showBid && <th style={{ ...th, textAlign: "right" }}>Bid</th>}
                  {prefs.showAsk && <th style={{ ...th, textAlign: "right" }}>Ask</th>}
                  {prefs.showChgPct && <th style={{ ...th, textAlign: "right" }}>Chg%</th>}
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
                    {prefs.showLast && <td style={num}>{fmt(q.last)}</td>}
                    {prefs.showBid && <td style={num}>{fmt(q.bid)}</td>}
                    {prefs.showAsk && <td style={num}>{fmt(q.ask)}</td>}
                    {prefs.showChgPct && <td style={{ ...num, color: signColor(q.changePct) }}>{fmt(q.changePct)}%</td>}
                    <td style={num}>
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
