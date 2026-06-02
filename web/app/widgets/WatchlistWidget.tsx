"use client";

import { useCallback, useState } from "react";
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
import type { Schemas } from "../lib/api/client";

const th: React.CSSProperties = { color: "var(--muted)", fontWeight: 400, padding: "0.3rem 0.6rem" };
const num: React.CSSProperties = { textAlign: "right", padding: "0.3rem 0.6rem" };
const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  padding: "0 0.2rem",
  fontFamily: "inherit",
};

// Small input + Add button. Submitting dispatches `watch <SYMBOL>` (reusing the
// store's dedupe path); Enter submits; empty/whitespace is a no-op.
function AddSymbol() {
  const [value, setValue] = useState("");
  const add = () => {
    const sym = value.trim().toUpperCase();
    if (!sym) return;
    terminalStore.dispatch(`watch ${sym}`);
    setValue("");
  };
  return (
    <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem" }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="add symbol — AAPL or BTC/USD"
        spellCheck={false}
        autoComplete="off"
        aria-label="add symbol to watchlist"
        style={{
          flex: 1,
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--foreground)",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          padding: "0.3rem 0.5rem",
          outline: "none",
        }}
      />
      <button
        onClick={add}
        style={{
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--accent)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          padding: "0.3rem 0.8rem",
        }}
      >
        Add
      </button>
    </div>
  );
}

export default function WatchlistWidget({ tabId }: { tabId: string }) {
  const { watchlist } = useTerminal();
  // Order-independent load key: reordering the list must NOT trigger a refetch.
  const key = [...watchlist].sort().join(",");
  const [prefs, setPrefs] = useWidgetPrefs(WATCHLIST_PREFS_KEY, DEFAULT_WATCHLIST_PREFS, coerceWatchlistPrefs);
  const load = useCallback(() => loadWatchlist(watchlist), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { on, setOn, pausedReason, onAutoDisabled } = useAutoRefreshToggle(tabId);
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
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing, paused: pausedReason }}
    >
      <AddSymbol />
      <ResourceView state={state}>
        {(data) => {
          // Render in display (watchlist) order, looking up each quote by symbol.
          const bySymbol = new Map(data.quotes.map((q) => [q.symbol, q]));
          if (watchlist.length === 0) {
            return (
              <p style={{ color: "var(--muted)" }}>
                Watchlist is empty. Add a symbol above, or use <code>watch &lt;SYMBOL&gt;</code>.
              </p>
            );
          }
          return (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Symbol</th>
                  {prefs.showLast && <th style={{ ...th, textAlign: "right" }}>Last</th>}
                  {prefs.showBid && <th style={{ ...th, textAlign: "right" }}>Bid</th>}
                  {prefs.showAsk && <th style={{ ...th, textAlign: "right" }}>Ask</th>}
                  {prefs.showChgPct && <th style={{ ...th, textAlign: "right" }}>Chg%</th>}
                  <th aria-hidden="true" style={{ padding: "0.3rem 0.6rem" }} />
                </tr>
              </thead>
              <tbody>
                {watchlist.map((symbol, i) => {
                  const q: Schemas["Quote"] | undefined = bySymbol.get(symbol);
                  return (
                    <tr key={symbol} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.3rem 0.6rem" }}>
                        <button
                          onClick={() => terminalStore.dispatch(`chart ${symbol}`)}
                          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                          title="open chart"
                        >
                          {symbol}
                        </button>
                      </td>
                      {prefs.showLast && <td style={num}>{fmt(q?.last)}</td>}
                      {prefs.showBid && <td style={num}>{fmt(q?.bid)}</td>}
                      {prefs.showAsk && <td style={num}>{fmt(q?.ask)}</td>}
                      {prefs.showChgPct && <td style={{ ...num, color: signColor(q?.changePct) }}>{fmt(q?.changePct)}%</td>}
                      <td style={{ ...num, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => terminalStore.moveWatchlistSymbol(symbol, "up")}
                          disabled={i === 0}
                          style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? "default" : "pointer" }}
                          title="move up"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => terminalStore.moveWatchlistSymbol(symbol, "down")}
                          disabled={i === watchlist.length - 1}
                          style={{ ...iconBtn, opacity: i === watchlist.length - 1 ? 0.3 : 1, cursor: i === watchlist.length - 1 ? "default" : "pointer" }}
                          title="move down"
                        >
                          ▼
                        </button>
                        <button
                          onClick={() => terminalStore.dispatch(`quote ${symbol}`)}
                          style={iconBtn}
                          title="open quote"
                        >
                          Q
                        </button>
                        <button
                          onClick={() => terminalStore.dispatch(`unwatch ${symbol}`)}
                          style={iconBtn}
                          title="remove from watchlist"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        }}
      </ResourceView>
    </WidgetFrame>
  );
}
