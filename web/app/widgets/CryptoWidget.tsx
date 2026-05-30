"use client";

import { useCallback } from "react";
import CandleChart from "../components/CandleChart";
import { fmt, ResourceView, signColor, WidgetFrame } from "../components/ui";
import { loadCrypto } from "../lib/loaders";
import { useResource } from "../lib/useResource";

export default function CryptoWidget({ pair }: { pair: string }) {
  const load = useCallback(() => loadCrypto(pair), [pair]);
  const { state, refresh } = useResource(load);
  const source = state.kind === "ok" ? state.data.source : undefined;

  return (
    <WidgetFrame title={`Crypto · ${pair}`} source={source} onRefresh={refresh} busy={state.kind === "loading"}>
      <ResourceView state={state}>
        {(data) => (
          <div>
            {data.quote && (
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "1.75rem" }}>{fmt(data.quote.last)}</span>
                <span style={{ color: signColor(data.quote.change) }}>
                  {data.quote.change != null && data.quote.change > 0 ? "+" : ""}
                  {fmt(data.quote.change)} ({fmt(data.quote.changePct)}%)
                </span>
              </div>
            )}
            {data.candles.length > 0 ? (
              <CandleChart candles={data.candles} />
            ) : (
              <p style={{ color: "var(--muted)" }}>No candles.</p>
            )}
          </div>
        )}
      </ResourceView>
    </WidgetFrame>
  );
}
