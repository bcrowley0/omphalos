// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { TerminalStore } from "./store";

beforeEach(() => {
  window.localStorage.clear();
});

describe("TerminalStore", () => {
  it("opens a tab for a command and makes it active", () => {
    const s = new TerminalStore();
    s.dispatch("chart AAPL");
    const st = s.getSnapshot();
    expect(st.tabs.map((t) => t.id)).toEqual(["chart:AAPL"]);
    expect(st.activeId).toBe("chart:AAPL");
  });

  it("focuses (does not duplicate) when the same command is re-run", () => {
    const s = new TerminalStore();
    s.dispatch("chart AAPL");
    s.dispatch("quote MSFT");
    s.dispatch("chart AAPL"); // re-run
    const st = s.getSnapshot();
    expect(st.tabs.map((t) => t.id)).toEqual(["chart:AAPL", "quote:MSFT"]);
    expect(st.activeId).toBe("chart:AAPL");
  });

  it("watch adds to the watchlist and opens the watchlist tab; unwatch removes", () => {
    const s = new TerminalStore();
    s.dispatch("watch NVDA");
    expect(s.getSnapshot().watchlist).toEqual(["NVDA"]);
    expect(s.getSnapshot().activeId).toBe("watchlist");
    s.dispatch("watch NVDA"); // no duplicate
    expect(s.getSnapshot().watchlist).toEqual(["NVDA"]);
    s.dispatch("unwatch NVDA");
    expect(s.getSnapshot().watchlist).toEqual([]);
  });

  it("bare watch / watchlist opens the watchlist tab without changing the list", () => {
    const s = new TerminalStore();
    s.dispatch("watch NVDA");
    s.dispatch("watch AAPL");
    s.dispatch("watch"); // bare: open only
    expect(s.getSnapshot().watchlist).toEqual(["NVDA", "AAPL"]);
    expect(s.getSnapshot().activeId).toBe("watchlist");
    s.dispatch("watchlist"); // verb form: also open only
    expect(s.getSnapshot().watchlist).toEqual(["NVDA", "AAPL"]);
  });

  it("moveWatchlistSymbol reorders up and down and persists", () => {
    const s = new TerminalStore();
    s.dispatch("watch A");
    s.dispatch("watch B");
    s.dispatch("watch C");
    s.moveWatchlistSymbol("C", "up");
    expect(s.getSnapshot().watchlist).toEqual(["A", "C", "B"]);
    s.moveWatchlistSymbol("A", "down");
    expect(s.getSnapshot().watchlist).toEqual(["C", "A", "B"]);

    const afterRefresh = new TerminalStore();
    expect(afterRefresh.getSnapshot().watchlist).toEqual(["C", "A", "B"]);
  });

  it("moveWatchlistSymbol is a no-op at the ends and for unknown symbols", () => {
    const s = new TerminalStore();
    s.dispatch("watch A");
    s.dispatch("watch B");
    s.moveWatchlistSymbol("A", "up"); // already first
    s.moveWatchlistSymbol("B", "down"); // already last
    s.moveWatchlistSymbol("Z", "up"); // not present
    expect(s.getSnapshot().watchlist).toEqual(["A", "B"]);
  });

  it("records an inline error for an unknown command without opening a tab", () => {
    const s = new TerminalStore();
    s.dispatch("frobnicate");
    const st = s.getSnapshot();
    expect(st.tabs).toEqual([]);
    expect(st.error).toMatch(/unknown/i);
  });

  it("closing the active tab activates a neighbor", () => {
    const s = new TerminalStore();
    s.dispatch("chart AAPL");
    s.dispatch("quote MSFT");
    s.dispatch("yield");
    s.focus("quote:MSFT");
    s.close("quote:MSFT");
    const st = s.getSnapshot();
    expect(st.tabs.map((t) => t.id)).toEqual(["chart:AAPL", "yield"]);
    expect(st.activeId).toBe("yield"); // neighbor at the same index
  });

  it("persists tabs + watchlist to localStorage so a fresh store (a refresh) restores them", () => {
    const first = new TerminalStore();
    first.dispatch("chart AAPL");
    first.dispatch("watch NVDA");

    // A brand-new instance simulates a browser refresh: it reads localStorage.
    const afterRefresh = new TerminalStore();
    const st = afterRefresh.getSnapshot();
    expect(st.tabs.map((t) => t.id)).toEqual(["chart:AAPL", "watchlist"]);
    expect(st.activeId).toBe("watchlist");
    expect(st.watchlist).toEqual(["NVDA"]);
  });

  it("does not persist transient history or error across a refresh", () => {
    const first = new TerminalStore();
    first.dispatch("frobnicate"); // sets error + history
    const afterRefresh = new TerminalStore();
    expect(afterRefresh.getSnapshot().error).toBeNull();
    expect(afterRefresh.getSnapshot().history).toEqual([]);
  });

  it("seeds a default roster on first run", () => {
    const s = new TerminalStore();
    const names = s.getSnapshot().following.map((p) => p.name);
    expect(names).toEqual(["Paul Tudor Jones", "Stanley Druckenmiller", "Andrej Karpathy", "Boris Cherny"]);
  });

  it("follow adds a person (no dup) and opens their tab; unfollow removes", () => {
    const s = new TerminalStore();
    s.dispatch("follow Jensen Huang");
    expect(s.getSnapshot().following.some((p) => p.name === "Jensen Huang")).toBe(true);
    expect(s.getSnapshot().activeId).toBe("person:Jensen Huang");
    s.dispatch("follow Jensen Huang");
    expect(s.getSnapshot().following.filter((p) => p.name === "Jensen Huang")).toHaveLength(1);
    s.dispatch("unfollow Jensen Huang");
    expect(s.getSnapshot().following.some((p) => p.name === "Jensen Huang")).toBe(false);
  });

  it("markSeen updates lastSeenTs and persists the following list across a refresh", () => {
    const first = new TerminalStore();
    first.dispatch("follow Jensen Huang");
    first.markSeen("Jensen Huang");
    const seen = first.getSnapshot().following.find((p) => p.name === "Jensen Huang")!.lastSeenTs;
    expect(seen).toBeGreaterThan(0);
    const afterRefresh = new TerminalStore();
    expect(afterRefresh.getSnapshot().following.some((p) => p.name === "Jensen Huang")).toBe(true);
  });

  it("addPersonFeed attaches a feed URL to a person", () => {
    const s = new TerminalStore();
    s.dispatch("follow Jensen Huang");
    s.addPersonFeed("Jensen Huang", "https://example.com/rss.xml");
    const p = s.getSnapshot().following.find((x) => x.name === "Jensen Huang")!;
    expect(p.feeds).toContain("https://example.com/rss.xml");
  });
});
