"use client";

import { useCallback } from "react";
import { loadHealth } from "../lib/loaders";
import { useResource } from "../lib/useResource";

// Small backend connectivity indicator (preserves the Phase 0 health round-trip
// visibly). Click to re-check.
export default function HealthChip() {
  const load = useCallback(() => loadHealth(), []);
  const { state, refresh } = useResource(load);

  const { color, label } =
    state.kind === "loading"
      ? { color: "var(--muted)", label: "backend …" }
      : state.kind === "ok"
        ? { color: "var(--accent)", label: `backend ${state.data.status}` }
        : { color: "var(--error)", label: "backend down" };

  return (
    <button
      onClick={refresh}
      title="re-check backend health"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "0.2rem 0.6rem",
        color: "var(--muted)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.75rem",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: "inline-block" }} />
      {label}
    </button>
  );
}
