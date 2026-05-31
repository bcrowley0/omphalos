import { describe, expect, it } from "vitest";
import { commandToTab } from "./tabs";
import { parseCommand } from "./parser";

const tabFor = (input: string) => commandToTab(parseCommand(input));

describe("commandToTab", () => {
  it("maps chart/quote to per-symbol tabs with stable dedup ids (crypto pairs go through chart)", () => {
    expect(tabFor("chart AAPL")).toMatchObject({ id: "chart:AAPL", widget: "chart", symbol: "AAPL" });
    expect(tabFor("quote MSFT")).toMatchObject({ id: "quote:MSFT", widget: "quote", symbol: "MSFT" });
    expect(tabFor("chart BTC/USD")).toMatchObject({ id: "chart:BTC/USD", widget: "chart", symbol: "BTC/USD" });
  });

  it("maps singleton commands to fixed ids so re-running focuses, not duplicates", () => {
    expect(tabFor("port")).toMatchObject({ id: "portfolio", widget: "portfolio" });
    expect(tabFor("yield")).toMatchObject({ id: "yield", widget: "yield" });
    expect(tabFor("cal")).toMatchObject({ id: "cal", widget: "cal" });
    expect(tabFor("help")).toMatchObject({ id: "help", widget: "help" });
  });

  it("maps news to a per-feed id, or a generic id when no feed given", () => {
    expect(tabFor("news")).toMatchObject({ id: "news", widget: "news" });
    expect(tabFor("news FT")).toMatchObject({ id: "news:FT", widget: "news", feed: "FT" });
  });

  it("maps watch and unwatch to the single watchlist tab", () => {
    expect(tabFor("watch NVDA")).toMatchObject({ id: "watchlist", widget: "watchlist" });
    expect(tabFor("unwatch NVDA")).toMatchObject({ id: "watchlist", widget: "watchlist" });
  });

  it("returns null for an error command (no tab opens)", () => {
    expect(tabFor("frobnicate")).toBeNull();
  });

  it("maps follow to a per-person tab and following to the roster", () => {
    expect(tabFor("follow Andrej Karpathy")).toMatchObject({
      id: "person:Andrej Karpathy", widget: "person", person: "Andrej Karpathy",
    });
    expect(tabFor("following")).toMatchObject({ id: "following", widget: "following" });
  });

  it("maps unfollow to the following roster tab", () => {
    expect(tabFor("unfollow Andrej Karpathy")).toMatchObject({ id: "following", widget: "following" });
  });
});
