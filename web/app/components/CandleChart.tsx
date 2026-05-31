"use client";

import { useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../lib/api/client";

// Renders candles with TradingView Lightweight Charts v5.
//
// v5 series API (verified against installed typings.d.ts): create the chart with
// createChart(el, opts), then chart.addSeries(CandlestickSeries, opts) — NOT the
// v4 chart.addCandlestickSeries(). The library is dynamically imported inside the
// effect so it only loads in the browser (never during SSR).
//
// Time scale wants seconds (UTCTimestamp); our canonical candle.t is epoch ms.
export default function CandleChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let cleanup = () => {};

    void (async () => {
      const { createChart, CandlestickSeries } = await import("lightweight-charts");
      if (disposed || !el) return;

      const chart = createChart(el, {
        width: el.clientWidth,
        height: 360,
        layout: {
          background: { color: "transparent" },
          textColor: "#7a8699",
        },
        grid: {
          vertLines: { color: "#1c2433" },
          horzLines: { color: "#1c2433" },
        },
        rightPriceScale: { borderColor: "#232b3a" },
        timeScale: { borderColor: "#232b3a", timeVisible: false },
      });

      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#4cc38a",
        downColor: "#e5534b",
        borderUpColor: "#4cc38a",
        borderDownColor: "#e5534b",
        wickUpColor: "#4cc38a",
        wickDownColor: "#e5534b",
      });

      series.setData(
        candles.map((c) => ({
          // UTCTimestamp is seconds since epoch
          time: Math.floor(c.t / 1000) as UTCTimestamp,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
        })),
      );
      chart.timeScale().fitContent();

      const onResize = () => chart.applyOptions({ width: el.clientWidth });
      window.addEventListener("resize", onResize);
      cleanup = () => {
        window.removeEventListener("resize", onResize);
        chart.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [candles]);

  return <div ref={containerRef} style={{ width: "100%" }} />;
}
