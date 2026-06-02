import { describe, expect, it } from "vitest";
import { ibkrBannerVisible, ibkrDotColor, ibkrLoginActionable } from "./ibkrAuth";

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

describe("ibkrLoginActionable", () => {
  it("offers the login link only when the gateway is up but not logged in", () => {
    expect(ibkrLoginActionable("unauthenticated")).toBe(true);
  });

  it("suppresses the login link when the gateway is unreachable (login page can't load)", () => {
    // The process isn't running, so opening the login URL yields a dead
    // "can't connect to localhost:5000" tab — guide the user to start it instead.
    expect(ibkrLoginActionable("unreachable")).toBe(false);
  });

  it("suppresses the login link when authenticated or state is unknown (null)", () => {
    expect(ibkrLoginActionable("authenticated")).toBe(false);
    expect(ibkrLoginActionable(null)).toBe(false);
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
