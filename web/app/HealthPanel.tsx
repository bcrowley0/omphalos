"use client";

import { useCallback, useState } from "react";

// Response read as a generic record, NOT a hand-written interface: per CLAUDE.md
// the Pydantic model is the single source of truth and the typed client is
// GENERATED from the backend OpenAPI schema (Phase 1).
export type Health = Record<string, string>;

export type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; data: Health }
  | { kind: "error"; message: string };

export default function HealthPanel({ initial }: { initial: HealthState }) {
  const [state, setState] = useState<HealthState>(initial);

  // Explicit, on-demand refresh (CLAUDE.md: snapshot/on-demand only, no
  // streaming). This client fetch goes through the /api proxy to the backend.
  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) {
        setState({ kind: "error", message: `backend returned HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as Health;
      setState({ kind: "ok", data });
    } catch {
      setState({
        kind: "error",
        message: "cannot reach backend (is the API running on :8000?)",
      });
    }
  }, []);

  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "1rem 1.25rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <strong>backend health</strong>
        <button
          onClick={() => void refresh()}
          disabled={state.kind === "loading"}
          style={{
            background: "transparent",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.3rem 0.7rem",
            cursor: state.kind === "loading" ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {state.kind === "loading" ? "checking…" : "refresh"}
        </button>
      </div>

      {state.kind === "loading" && (
        <p style={{ color: "var(--muted)" }}>checking /api/health…</p>
      )}

      {state.kind === "error" && (
        <p style={{ color: "var(--error)" }}>✕ {state.message}</p>
      )}

      {state.kind === "ok" && (
        <div>
          <p style={{ color: "var(--accent)", marginBottom: "0.5rem" }}>
            ✓ round-trip ok (frontend → /api proxy → FastAPI)
          </p>
          <pre
            style={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0.75rem",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(state.data, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
