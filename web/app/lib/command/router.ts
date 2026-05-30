import type { Source } from "./types";

// Pure symbol router (CLAUDE.md): decide which backend source serves a symbol.
// Rule: an `X/Y` pair (contains a slash) is a crypto pair → Kraken; a plain
// ticker → IBKR. Deterministic and unit-tested so the routing decision is
// explicit, never guessed at the call site.
export function routeSymbol(symbol: string): Source {
  const normalized = symbol.trim().toUpperCase();
  return normalized.includes("/") ? "kraken" : "ibkr";
}
