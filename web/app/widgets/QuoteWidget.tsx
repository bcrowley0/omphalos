"use client";

import { useCallback } from "react";
import { fmt, ResourceView, signColor, StatusNotice, WidgetFrame } from "../components/ui";
import { loadQuote } from "../lib/loaders";
import { useResource } from "../lib/useResource";
import type { Quote } from "../lib/api/client";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function QuoteBody({ q }: { q: Quote }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "2rem" }}>{fmt(q.last)}</span>
        <span style={{ color: signColor(q.change) }}>
          {q.change != null && q.change > 0 ? "+" : ""}
          {fmt(q.change)} ({fmt(q.changePct)}%)
        </span>
        {q.stale && <span style={{ color: "#d9a441", fontSize: "0.8rem" }}>stale</span>}
      </div>
      <Row label="bid" value={fmt(q.bid)} />
      <Row label="ask" value={fmt(q.ask)} />
      <Row label="last" value={fmt(q.last)} />
    </div>
  );
}

export default function QuoteWidget({ symbol }: { symbol: string }) {
  const load = useCallback(() => loadQuote(symbol), [symbol]);
  const { state, refresh } = useResource(load);
  const source = state.kind === "ok" ? state.data.quote?.source : undefined;

  return (
    <WidgetFrame title={`Quote · ${symbol}`} source={source} onRefresh={refresh} busy={state.kind === "loading"}>
      <ResourceView state={state}>
        {(data) =>
          data.quote ? <QuoteBody q={data.quote} /> : <StatusNotice status="empty" message="No quote." />
        }
      </ResourceView>
    </WidgetFrame>
  );
}
