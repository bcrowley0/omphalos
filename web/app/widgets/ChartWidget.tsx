"use client";

import { useCallback, useMemo, useState } from "react";
import CandleChart from "../components/CandleChart";
import ChartControls from "../components/ChartControls";
import { ResourceView, WidgetFrame } from "../components/ui";
import WidgetSettingsMenu, { ToggleRow } from "../components/WidgetSettingsMenu";
import { resolveRange } from "../lib/chart/range";
import type { Interval, Span } from "../lib/chart/range";
import { loadChartData } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import { loadAppSettings } from "../lib/appSettings";
import { useAutoRefreshToggle } from "../lib/useAutoRefreshToggle";
import { autoRefreshMsFor, statusIsHealthy } from "../lib/autoRefresh";
import { useWidgetPrefs } from "../lib/widgetPrefs";
import { CHART_PREFS_KEY, coerceChartPrefs, DEFAULT_CHART_PREFS } from "../lib/widgetSettings";

export default function ChartWidget({ symbol, tabId }: { symbol: string; tabId: string }) {
  // Initial range from the user's saved defaults (default 1M/1h), snapped to a
  // valid span/interval pair.
  const init = useMemo(() => {
    const s = loadAppSettings();
    return resolveRange(s.defaultSpan, s.defaultInterval);
  }, []);
  const [span, setSpan] = useState<Span>(init.span);
  const [interval, setInterval] = useState<Interval>(init.interval);
  const [prefs, setPrefs] = useWidgetPrefs(CHART_PREFS_KEY, DEFAULT_CHART_PREFS, coerceChartPrefs);

  const load = useCallback(() => loadChartData(symbol, interval, span), [symbol, interval, span]);
  const { on, setOn } = useAutoRefreshToggle(tabId);
  const onAutoDisabled = useCallback(() => setOn(false), [setOn]);
  const { state, refresh, isRefreshing } = useResource(load, {
    enabled: on,
    intervalMs: autoRefreshMsFor("chart"),
    isHealthy: statusIsHealthy,
    onAutoDisabled,
  });
  const source = prefs.showSource && state.kind === "ok" ? state.data.source : undefined;

  // Picking a span may snap the interval (resolveRange) so the pair stays valid.
  const selectSpan = (s: Span) => {
    const r = resolveRange(s, interval);
    setSpan(r.span);
    setInterval(r.interval);
  };

  const settings = (
    <WidgetSettingsMenu title="chart settings">
      <ToggleRow label="Show source" checked={prefs.showSource} onChange={() => setPrefs({ ...prefs, showSource: !prefs.showSource })} />
    </WidgetSettingsMenu>
  );

  return (
    <WidgetFrame
      title={`Chart · ${symbol}`}
      source={source}
      onRefresh={refresh}
      busy={state.kind === "loading"}
      headerExtra={settings}
      autoRefresh={{ on, onToggle: setOn, refreshing: isRefreshing }}
    >
      <ChartControls
        span={span}
        interval={interval}
        onSpanChange={selectSpan}
        onIntervalChange={setInterval}
      />
      <ResourceView state={state}>
        {(data) =>
          data.candles.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No candles.</p>
          ) : (
            <CandleChart candles={data.candles} />
          )
        }
      </ResourceView>
    </WidgetFrame>
  );
}
