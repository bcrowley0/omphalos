import { api } from "./api/client";
import type { Schemas } from "./api/client";
import type { Person } from "./command/types";
import type { Interval, Span } from "./chart/range";

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

export async function loadStatus(): Promise<Schemas["StatusResponse"]> {
  const { data, error } = await api.GET("/status", {});
  return unwrap(data, error);
}

// Local-first key entry: write keys to api/.env via the localhost backend. Only
// non-empty fields are sent; the response carries status only, never key values.
export async function saveKeys(body: Schemas["KeysUpdateRequest"]): Promise<Schemas["StatusResponse"]> {
  const { data, error } = await api.POST("/status/keys", { body });
  return unwrap(data, error);
}

export async function loadChart(
  symbol: string,
  interval: Interval = "1d",
  span: Span = "1M",
): Promise<Schemas["CandlesResponse"]> {
  const { data, error } = await api.GET("/chart", {
    params: { query: { symbol, interval, span } },
  });
  return unwrap(data, error);
}

export async function loadQuote(symbol: string): Promise<Schemas["QuoteResponse"]> {
  const { data, error } = await api.GET("/quote", { params: { query: { symbol } } });
  return unwrap(data, error);
}

export async function loadPortfolio(): Promise<Schemas["PortfolioResponse"]> {
  const { data, error } = await api.GET("/portfolio", {});
  return unwrap(data, error);
}

export async function loadYield(asof: string[] = []): Promise<Schemas["YieldCurveResponse"]> {
  const { data, error } = await api.GET("/yield", { params: { query: { asof } } });
  return unwrap(data, error);
}

export async function loadNews(feed?: string): Promise<Schemas["NewsResponse"]> {
  const { data, error } = await api.GET("/news", { params: { query: feed ? { feed } : {} } });
  return unwrap(data, error);
}

export async function loadPeopleFeed(people: Person[]): Promise<Schemas["PeopleFeedResponse"]> {
  const { data, error } = await api.POST("/people/feed", {
    body: {
      people: people.map((p) => ({ name: p.name, enabled: p.enabled, anchors: p.anchors })),
      limitPerPerson: 25,
    },
  });
  return unwrap(data, error);
}

export async function loadSwaps(): Promise<Schemas["SwapsResponse"]> {
  const { data, error } = await api.GET("/swaps", {});
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

export async function loadCatalog(): Promise<Schemas["CatalogResponse"]> {
  const { data, error } = await api.GET("/news/catalog", {});
  return unwrap(data, error);
}

export async function enableSource(name: string): Promise<Schemas["FeedListResponse"]> {
  const { data, error } = await api.POST("/news/sources/enable", { body: { name } });
  return unwrap(data, error);
}

export async function disableSource(name: string): Promise<Schemas["FeedListResponse"]> {
  const { data, error } = await api.POST("/news/sources/disable", { body: { name } });
  return unwrap(data, error);
}

// Unified chart/quote loaders. The backend symbol resolver routes crypto vs
// equity from the raw symbol (e.g. `btc`, `BTC/USD`, `aapl`), so the frontend
// just passes the symbol through. Both normalize to a common shape so widgets
// stay source-agnostic.
export type ChartData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  source: string;
  candles: Schemas["Candle"][];
};

export async function loadChartData(
  symbol: string,
  interval: Interval = "1d",
  span: Span = "1M",
): Promise<ChartData> {
  const r = await loadChart(symbol, interval, span);
  return { status: r.status, message: r.message, source: r.source, candles: r.candles };
}

export type QuoteData = {
  status: Schemas["SourceStatus"];
  message?: string | null;
  quote: Schemas["Quote"] | null | undefined;
};

export async function loadQuoteData(symbol: string): Promise<QuoteData> {
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
