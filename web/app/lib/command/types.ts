// Result of parsing a command-bar line. Discriminated union on `kind` so each
// widget-opening intent carries exactly the data it needs.
export type Command =
  | { kind: "chart"; symbol: string }
  | { kind: "quote"; symbol: string }
  | { kind: "watch"; symbol: string }
  | { kind: "unwatch"; symbol: string }
  | { kind: "port" }
  | { kind: "yield" }
  | { kind: "news"; feed?: string }
  | { kind: "cal" }
  | { kind: "help" }
  | { kind: "follow"; name: string }
  | { kind: "unfollow"; name: string }
  | { kind: "following" }
  | { kind: "error"; input: string; message: string };

// The widget a tab renders.
export type WidgetKind =
  | "chart"
  | "quote"
  | "watchlist"
  | "portfolio"
  | "yield"
  | "news"
  | "cal"
  | "help"
  | "following"
  | "person";

// An open widget tab. `id` is a stable dedup key: opening a command whose id
// already exists focuses that tab instead of creating a duplicate.
export type Tab = {
  id: string;
  widget: WidgetKind;
  title: string;
  symbol?: string;
  feed?: string;
  person?: string;
};

// A followed person. `lastSeenTs` drives the "new since you last looked" badge.
export type Person = { name: string; feeds: string[]; lastSeenTs: number };
