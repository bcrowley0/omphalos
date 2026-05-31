import { api } from "./api/client";
import type { Schemas } from "./api/client";

// Live IBKR gateway connection state. Types flow from the generated OpenAPI
// schema — no hand-written duplicates (CLAUDE.md type contract).
export type IbkrAuth = Schemas["IbkrAuthResponse"];
export type IbkrAuthState = IbkrAuth["state"];

// On-demand fetch of the gateway auth state. Throws on a transport/HTTP failure;
// the provider catches it and treats the state as unknown (so we never show a
// false "log in" prompt when the backend itself is down).
export async function loadIbkrAuth(): Promise<IbkrAuth> {
  const { data, error } = await api.GET("/ibkr/auth", {});
  if (error || data === undefined) throw new Error("request failed");
  return data;
}

// Pure: the login banner shows only when the gateway is reachable-but-not-logged-in
// or unreachable. `null` (unknown / backend down) and "authenticated" → hidden.
export function ibkrBannerVisible(state: IbkrAuthState | null): boolean {
  return state === "unauthenticated" || state === "unreachable";
}

// Pure: status-dot color for the Settings connections row.
export function ibkrDotColor(state: IbkrAuthState | null): string {
  switch (state) {
    case "authenticated":
      return "var(--accent)";
    case "unauthenticated":
      return "#d9a441";
    case "unreachable":
      return "var(--error)";
    default:
      return "var(--muted)";
  }
}
