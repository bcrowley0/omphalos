"use client";

import { useCallback } from "react";
import CandleChart from "../components/CandleChart";
import { ResourceView, WidgetFrame } from "../components/ui";
import { loadChart } from "../lib/loaders";
import { useResource } from "../lib/useResource";

export default function ChartWidget({ symbol }: { symbol: string }) {
  const load = useCallback(() => loadChart(symbol), [symbol]);
  const { state, refresh } = useResource(load);
  const source = state.kind === "ok" ? state.data.source : undefined;

  return (
    <WidgetFrame title={`Chart · ${symbol}`} source={source} onRefresh={refresh} busy={state.kind === "loading"}>
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
