import { describe, expect, it } from "vitest";
import { routeSymbol } from "./router";

describe("routeSymbol", () => {
  it("routes a slash pair like BTC/USD to kraken", () => {
    expect(routeSymbol("BTC/USD")).toBe("kraken");
  });

  it("routes any X/Y pair to kraken regardless of quote currency", () => {
    expect(routeSymbol("ETH/EUR")).toBe("kraken");
    expect(routeSymbol("SOL/USDT")).toBe("kraken");
  });

  it("routes a plain equity ticker to ibkr", () => {
    expect(routeSymbol("AAPL")).toBe("ibkr");
  });

  it("is case-insensitive (normalizes before deciding)", () => {
    expect(routeSymbol("btc/usd")).toBe("kraken");
    expect(routeSymbol("msft")).toBe("ibkr");
  });

  it("tolerates surrounding whitespace", () => {
    expect(routeSymbol("  BTC/USD  ")).toBe("kraken");
  });
});
