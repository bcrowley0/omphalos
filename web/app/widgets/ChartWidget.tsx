"use client";

import { useCallback, useState } from "react";
import CandleChart from "../components/CandleChart";
import ChartControls from "../components/ChartControls";
import { ResourceView, WidgetFrame } from "../components/ui";
import { resolveRange } from "../lib/chart/range";
import type { Interval, Span } from "../lib/chart/range";
import { loadChartData } from "../lib/loaders";
import { useResource } from "../lib/useResource";

export default function ChartWidget({ symbol }: { symbol: string }) {
  const [span, setSpan] = useState<Span>("1M");
  const [interval, setInterval] = useState<Interval>("1h");

  const load = useCallback(() => loadChartData(symbol, interval, span), [symbol, interval, span]);
  const { state, refresh } = useResource(load);
  const source = state.kind === "ok" ? state.data.source : undefined;

  // Picking a span may snap the interval (resolveRange) so the pair stays valid.
  const selectSpan = (s: Span) => {
    const r = resolveRange(s, interval);
    setSpan(r.span);
    setInterval(r.interval);
  };

  return (
    <WidgetFrame title={`Chart · ${symbol}`} source={source} onRefresh={refresh} busy={state.kind === "loading"}>
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
