import { describe, expect, it } from "vitest";
import { parseCommand } from "./parser";

describe("parseCommand", () => {
  it("parses `chart AAPL` into a chart command with an upper-cased symbol", () => {
    expect(parseCommand("chart aapl")).toEqual({ kind: "chart", symbol: "AAPL" });
  });

  it("parses `quote MSFT`", () => {
    expect(parseCommand("quote MSFT")).toEqual({ kind: "quote", symbol: "MSFT" });
  });

  it("parses `watch NVDA` and `unwatch NVDA`", () => {
    expect(parseCommand("watch nvda")).toEqual({ kind: "watch", symbol: "NVDA" });
    expect(parseCommand("unwatch nvda")).toEqual({ kind: "unwatch", symbol: "NVDA" });
  });

  it("parses argless commands `port`, `yield`, `cal`, `help`", () => {
    expect(parseCommand("port")).toEqual({ kind: "port" });
    expect(parseCommand("yield")).toEqual({ kind: "yield" });
    expect(parseCommand("cal")).toEqual({ kind: "cal" });
    expect(parseCommand("help")).toEqual({ kind: "help" });
  });

  it("parses `crypto BTC/USD` preserving the pair (upper-cased)", () => {
    expect(parseCommand("crypto btc/usd")).toEqual({ kind: "crypto", pair: "BTC/USD" });
  });

  it("parses `news` with no feed and `news <feed>` with a feed", () => {
    expect(parseCommand("news")).toEqual({ kind: "news", feed: undefined });
    expect(parseCommand("news FT")).toEqual({ kind: "news", feed: "FT" });
  });

  it("is case-insensitive on the verb and tolerant of surrounding whitespace", () => {
    expect(parseCommand("  CHART   aapl ")).toEqual({ kind: "chart", symbol: "AAPL" });
  });

  it("returns an error for an empty input", () => {
    const r = parseCommand("   ");
    expect(r.kind).toBe("error");
  });

  it("returns an error for an unknown verb", () => {
    const r = parseCommand("frobnicate XYZ");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/unknown/i);
  });

  it("returns an error when a symbol-requiring command is missing its argument", () => {
    const r = parseCommand("chart");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/symbol|argument|usage/i);
  });

  it("returns an error when `crypto` is missing its pair", () => {
    expect(parseCommand("crypto").kind).toBe("error");
  });
});
