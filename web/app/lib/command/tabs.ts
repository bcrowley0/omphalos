import type { Command, Tab } from "./types";

// Map a parsed command to the tab it should open or focus. Pure: the dedup id
// is derived deterministically so re-running a command focuses the existing tab.
// `watch`/`unwatch` both target the single watchlist tab (the list mutation is
// applied separately by the store). Returns null for commands that open no tab
// (errors).
export function commandToTab(cmd: Command): Tab | null {
  switch (cmd.kind) {
    case "chart":
      return { id: `chart:${cmd.symbol}`, widget: "chart", title: `Chart ${cmd.symbol}`, symbol: cmd.symbol };
    case "quote":
      return { id: `quote:${cmd.symbol}`, widget: "quote", title: `Quote ${cmd.symbol}`, symbol: cmd.symbol };
    case "watch":
    case "unwatch":
      return { id: "watchlist", widget: "watchlist", title: "Watchlist" };
    case "port":
      return { id: "portfolio", widget: "portfolio", title: "Portfolio" };
    case "yield":
      return { id: "yield", widget: "yield", title: "Yield Curve" };
    case "news":
      return cmd.feed
        ? { id: `news:${cmd.feed}`, widget: "news", title: `News ${cmd.feed}`, feed: cmd.feed }
        : { id: "news", widget: "news", title: "News" };
    case "cal":
      return { id: "cal", widget: "cal", title: "Calendar" };
    case "help":
      return { id: "help", widget: "help", title: "Help" };
    case "follow":
      return { id: `person:${cmd.name}`, widget: "person", title: cmd.name, person: cmd.name };
    case "unfollow":
      return { id: "following", widget: "following", title: "Following" };
    case "following":
      return { id: "following", widget: "following", title: "Following" };
    case "error":
      return null;
  }
}
