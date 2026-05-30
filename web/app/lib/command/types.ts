// Result of parsing a command-bar line. Discriminated union on `kind` so each
// widget-opening intent carries exactly the data it needs.
export type Command =
  | { kind: "chart"; symbol: string }
  | { kind: "quote"; symbol: string }
  | { kind: "watch"; symbol: string }
  | { kind: "unwatch"; symbol: string }
  | { kind: "port" }
  | { kind: "yield" }
  | { kind: "crypto"; pair: string }
  | { kind: "news"; feed?: string }
  | { kind: "cal" }
  | { kind: "help" }
  | { kind: "error"; input: string; message: string };

// Which backend source serves a given symbol (CLAUDE.md symbol router).
export type Source = "ibkr" | "kraken";

// The widget a tab renders.
export type WidgetKind =
  | "chart"
  | "quote"
  | "watchlist"
  | "portfolio"
  | "yield"
  | "crypto"
  | "news"
  | "cal"
  | "help";

// An open widget tab. `id` is a stable dedup key: opening a command whose id
// already exists focuses that tab instead of creating a duplicate.
export type Tab = {
  id: string;
  widget: WidgetKind;
  title: string;
  symbol?: string;
  pair?: string;
  feed?: string;
};
