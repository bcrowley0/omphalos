import { describe, expect, it } from "vitest";
import { ibkrBannerVisible, ibkrDotColor } from "./ibkrAuth";

describe("ibkrBannerVisible", () => {
  it("shows when the gateway is unauthenticated or unreachable", () => {
    expect(ibkrBannerVisible("unauthenticated")).toBe(true);
    expect(ibkrBannerVisible("unreachable")).toBe(true);
  });

  it("hides when authenticated or state is unknown (null)", () => {
    expect(ibkrBannerVisible("authenticated")).toBe(false);
    expect(ibkrBannerVisible(null)).toBe(false);
  });
});

describe("ibkrDotColor", () => {
  it("maps each state to a distinct dot color", () => {
    expect(ibkrDotColor("authenticated")).toBe("var(--accent)");
    expect(ibkrDotColor("unauthenticated")).toBe("#d9a441");
    expect(ibkrDotColor("unreachable")).toBe("var(--error)");
    expect(ibkrDotColor(null)).toBe("var(--muted)");
  });
});
