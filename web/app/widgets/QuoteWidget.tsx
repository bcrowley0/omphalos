"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, StatusNotice, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { ToggleRow } from "../components/WidgetSettingsMenu";
import { loadQuoteData } from "../lib/loaders";
import type { QuoteData } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { coerceQuotePrefs, DEFAULT_QUOTE_PREFS, QUOTE_PREFS_KEY } from "../lib/widgetSettings";
import { periodCells, dayStatRows, rangeRows } from "../lib/quoteView";
import type { Quote, SourceStatus } from "../lib/api/client";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PeriodLadder({
  changes,
  status,
}: {
  changes: QuoteData["periodChanges"];
  status: SourceStatus;
}) {
  const cells = periodCells(changes);
  return (
    <div style={{ margin: "0.5rem 0 0.85rem" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {cells.map((c) => (
          <div key={c.period} style={{ textAlign: "center", minWidth: "3rem" }}>
            <div style={{ color: "var(--muted)", fontSize: "0.7rem" }}>{c.period}</div>
            <div style={{ color: signColor(c.pct) }}>
              {c.pct == null ? "—" : `${c.pct > 0 ? "+" : ""}${fmt(c.pct)}%`}
            </div>
          </div>
        ))}
      </div>
      {status !== "ok" && status !== "empty" && (
        <div style={{ marginTop: "0.5rem" }}>
          <StatusNotice status={status} message="Price history unavailable." />
        </div>
      )}
    </div>
  );
}

function QuoteBody({
  q,
  data,
  showStale,
  showPeriods,
  showDayStats,
}: {
  q: Quote;
  data: QuoteData;
  showStale: boolean;
  showPeriods: boolean;
  showDayStats: boolean;
}) {
  const stats = dayStatRows(q);
  const fundamentals = rangeRows(q);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "2rem" }}>{fmt(q.last)}</span>
        <span style={{ color: signColor(q.change) }}>
          {q.change != null && q.change > 0 ? "+" : ""}
          {fmt(q.change)} ({fmt(q.changePct)}%)
        </span>
        {showStale && q.stale && <span style={{ color: "#d9a441", fontSize: "0.8rem" }}>stale</span>}
      </div>

      {showPeriods && <PeriodLadder changes={data.periodChanges} status={data.periodStatus} />}

      {showDayStats &&
        stats.map((r) => (
          <Row key={r.label} label={r.label} value={fmt(r.value, r.label === "volume" ? 0 : 2)} />
        ))}

      {fundamentals.map((r) => (
        <Row key={r.label} label={r.label} value={fmt(r.value, r.label === "mkt cap" ? 0 : 2)} />
      ))}

      <Row label="bid" value={fmt(q.bid)} />
      <Row label="ask" value={fmt(q.ask)} />
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
      <ToggleRow label="Show period changes" checked={prefs.showPeriods} onChange={() => setPrefs({ ...prefs, showPeriods: !prefs.showPeriods })} />
      <ToggleRow label="Show day stats" checked={prefs.showDayStats} onChange={() => setPrefs({ ...prefs, showDayStats: !prefs.showDayStats })} />
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
          data.quote ? (
            <QuoteBody
              q={data.quote}
              data={data}
              showStale={prefs.showStale}
              showPeriods={prefs.showPeriods}
              showDayStats={prefs.showDayStats}
            />
          ) : (
            <StatusNotice status="empty" message="No quote." />
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
