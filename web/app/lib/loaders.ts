import { api } from "./api/client";
import type { Schemas } from "./api/client";
import { routeSymbol } from "./command/router";

// Thin wrappers over the typed client. Each returns the canonical response
// envelope (or throws on a transport/HTTP failure, which useResource maps to
// the transport_error state). No hand-written shapes — all types flow from the
// generated schema.

function unwrap<T>(data: T | undefined, error: unknown): T {
  if (error || data === undefined) throw new Error("request failed");
  return data;
}

export async function loadHealth(): Promise<Schemas["HealthResponse"]> {
  const { data, error } = await api.GET("/health", {});
  return unwrap(data, error);
}

export async function loadChart(symbol: string): Promise<Schemas["CandlesResponse"]> {
  const { data, error } = await api.GET("/chart/{symbol}", { params: { path: { symbol } } });
  return unwrap(data, error);
}

export async function loadQuote(symbol: string): Promise<Schemas["QuoteResponse"]> {
  const { data, error } = await api.GET("/quote/{symbol}", { params: { path: { symbol } } });
  return unwrap(data, error);
}

export async function loadCrypto(pair: string): Promise<Schemas["CryptoResponse"]> {
  const [base, quoteCcy] = pair.split("/");
  const { data, error } = await api.GET("/crypto/{base}/{quote_ccy}", {
    params: { path: { base, quote_ccy: quoteCcy } },
  });
  return unwrap(data, error);
}

export async function loadPortfolio(): Promise<Schemas["PortfolioResponse"]> {
  const { data, error } = await api.GET("/portfolio", {});
  return unwrap(data, error);
}

export async function loadYield(): Promise<Schemas["YieldCurveResponse"]> {
  const { data, error } = await api.GET("/yield", {});
  return unwrap(data, error);
}

export async function loadNews(feed?: string): Promise<Schemas["NewsResponse"]> {
  const { data, error } = await api.GET("/news", { params: { query: feed ? { feed } : {} } });
  return unwrap(data, error);
}

export async function loadCalendar(): Promise<Schemas["CalendarResponse"]> {
  const { data, error } = await api.GET("/calendar", {});
  return unwrap(data, error);
}

export async function loadFeeds(): Promise<Schemas["FeedListResponse"]> {
  const { data, error } = await api.GET("/news/feeds", {});
  return unwrap(data, error);
}

export async function addFeed(name: string, url: string): Promise<Schemas["FeedListResponse"]> {
  const { data, error } = await api.POST("/news/feeds", { body: { name, url } });
  return unwrap(data, error);
}

// Unified chart/quote loaders. A pair (e.g. BTC/USD) routes to Kraken via the
// /crypto endpoint (a slash can't pass through /chart/{symbol}); a plain ticker
// routes to /chart or /quote (IBKR). Both normalize to a common shape so the
// widgets stay source-agnostic.
export type ChartData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  source: string;
  candles: Schemas["Candle"][];
};

export async function loadChartData(symbol: string): Promise<ChartData> {
  if (routeSymbol(symbol) === "kraken") {
    const r = await loadCrypto(symbol);
    return { status: r.status, message: r.message, source: r.source, candles: r.candles };
  }
  const r = await loadChart(symbol);
  return { status: r.status, message: r.message, source: r.source, candles: r.candles };
}

export type QuoteData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  quote: Schemas["Quote"] | null | undefined;
};

export async function loadQuoteData(symbol: string): Promise<QuoteData> {
  if (routeSymbol(symbol) === "kraken") {
    const r = await loadCrypto(symbol);
    return { status: r.status, message: r.message, quote: r.quote };
  }
  const r = await loadQuote(symbol);
  return { status: r.status, message: r.message, quote: r.quote };
}

// Composite loader for the watchlist: fetch a quote per watched symbol. Returns
// an envelope-shaped object so it flows through ResourceView like the others.
export type WatchlistData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  quotes: Schemas["Quote"][];
};

export async function loadWatchlist(symbols: string[]): Promise<WatchlistData> {
  if (symbols.length === 0) {
    return { status: "empty", message: "Watchlist is empty. Add with: watch <SYMBOL>", quotes: [] };
  }
  const results = await Promise.all(symbols.map((s) => loadQuoteData(s)));
  const quotes = results.map((r) => r.quote).filter((q): q is Schemas["Quote"] => Boolean(q));
  return { status: "ok", quotes };
}
