"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, StatusNotice, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { ToggleRow } from "../components/WidgetSettingsMenu";
import { loadQuoteData } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { coerceQuotePrefs, DEFAULT_QUOTE_PREFS, QUOTE_PREFS_KEY } from "../lib/widgetSettings";
import type { Quote } from "../lib/api/client";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function QuoteBody({ q, showStale }: { q: Quote; showStale: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "2rem" }}>{fmt(q.last)}</span>
        <span style={{ color: signColor(q.change) }}>
          {q.change != null && q.change > 0 ? "+" : ""}
          {fmt(q.change)} ({fmt(q.changePct)}%)
        </span>
        {showStale && q.stale && <span style={{ color: "#d9a441", fontSize: "0.8rem" }}>stale</span>}
      </div>
      <Row label="bid" value={fmt(q.bid)} />
      <Row label="ask" value={fmt(q.ask)} />
      <Row label="last" value={fmt(q.last)} />
    </div>
  );
}

export default function QuoteWidget({ symbol, tabId }: { symbol: string; tabId: string }) {
  const [prefs, setPrefs] = useWidgetPrefs(QUOTE_PREFS_KEY, DEFAULT_QUOTE_PREFS, coerceQuotePrefs);
  const load = useCallback(() => loadQuoteData(symbol), [symbol]);
  const { on, setOn, pausedReason, onAutoDisabled } = useAutoRefreshToggle(tabId);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("quote"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });

  const source = prefs.showSource && state.kind === "ok" ? state.data.quote?.source : undefined;

  const settings = (
    <WidgetSettingsMenu title="quote settings">
      <ToggleRow label="Show source" checked={prefs.showSource} onChange={() => setPrefs({ ...prefs, showSource: !prefs.showSource })} />
      <ToggleRow label="Show stale badge" checked={prefs.showStale} onChange={() => setPrefs({ ...prefs, showStale: !prefs.showStale })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title={`Quote · ${symbol}`}
      source={source}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing, paused: pausedReason }}
    >
      <ResourceView state={state}>
        {(data) =>
          data.quote ? <QuoteBody q={data.quote} showStale={prefs.showStale} /> : <StatusNotice status="empty" message="No quote." />
        }
      </ResourceView>
    </WidgetFrame>
  );
}
