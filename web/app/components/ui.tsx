"use client";

import type { ReactNode } from "react";
import type { ResourceState } from "../lib/useResource";
import type { SourceStatus } from "../lib/api/client";

// Shared loading / error / empty / status UI reused by every widget
// (CLAUDE.md: "Shared loading/error UI components reused by all widgets" and
// hard rule #6 — explicit visible states for loading, source-down,
// unauthenticated, rate-limited, and empty).

export function Loading({ label = "loading…" }: { label?: string }) {
  return <p style={{ color: "var(--muted)", padding: "0.5rem 0" }}>{label}</p>;
}

type Tone = "error" | "warn" | "info";
const TONE_COLOR: Record<Tone, string> = {
  error: "var(--error)",
  warn: "#d9a441",
  info: "var(--muted)",
};

export function Banner({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      style={{
        color: TONE_COLOR[tone],
        border: `1px solid ${TONE_COLOR[tone]}`,
        borderRadius: 6,
        padding: "0.6rem 0.8rem",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      {children}
    </div>
  );
}

// Human-readable mapping of a non-ok source status to a (tone, message).
function describeStatus(status: SourceStatus, message?: string | null): { tone: Tone; text: string } {
  switch (status) {
    case "source_down":
      return { tone: "error", text: message || "Source is unreachable." };
    case "unauthenticated":
      return { tone: "warn", text: message || "Not authenticated for this source." };
    case "rate_limited":
      return { tone: "warn", text: message || "Rate limit hit; try again shortly." };
    case "not_implemented":
      return { tone: "info", text: message || "Not implemented yet." };
    case "empty":
      return { tone: "info", text: message || "No data." };
    default:
      return { tone: "info", text: message || status };
  }
}

export function StatusNotice({ status, message }: { status: SourceStatus; message?: string | null }) {
  const { tone, text } = describeStatus(status, message);
  return <Banner tone={tone}>{text}</Banner>;
}

// Renders the common parts of a resource lifecycle. Calls `children` only when
// the envelope status is "ok" or "empty"; everything else (loading, transport
// failure, source-down/unauth/rate-limited/not-implemented) renders a notice.
export function ResourceView<T extends { status: SourceStatus; message?: string | null }>({
  state,
  children,
}: {
  state: ResourceState<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.kind === "loading") return <Loading />;
  if (state.kind === "transport_error") return <Banner tone="error">{state.message}</Banner>;
  const { data } = state;
  if (data.status !== "ok" && data.status !== "empty") {
    return <StatusNotice status={data.status} message={data.message} />;
  }
  return <>{children(data)}</>;
}

// Standard widget chrome: title + source label + optional auto-refresh toggle +
// refresh button (on-demand only; auto-refresh is opt-in per CLAUDE.md rule 5).
export function WidgetFrame({
  title,
  source,
  onRefresh,
  busy,
  headerExtra,
  autoRefresh,
  children,
}: {
  title: string;
  source?: string;
  onRefresh: () => void;
  busy: boolean;
  headerExtra?: ReactNode;
  autoRefresh?: { on: boolean; onToggle: (on: boolean) => void; refreshing: boolean; paused?: string | null };
  children: ReactNode;
}) {
  return (
    <div style={{ padding: "1rem 1.25rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.85rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <strong style={{ fontSize: "1.05rem" }}>{title}</strong>
          {source && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>via {source}</span>}
          {autoRefresh?.on && autoRefresh.refreshing && (
            <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>updating…</span>
          )}
          {autoRefresh && !autoRefresh.on && autoRefresh.paused && (
            <span style={{ color: "#d9a441", fontSize: "0.75rem" }}>{autoRefresh.paused}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {headerExtra}
          {autoRefresh && (
            <button
              onClick={() => autoRefresh.onToggle(!autoRefresh.on)}
              title={autoRefresh.on ? "Auto-refresh on — click to turn off" : "Auto-refresh off — click to turn on"}
              aria-pressed={autoRefresh.on}
              style={{
                background: autoRefresh.on ? "var(--accent)" : "transparent",
                color: autoRefresh.on ? "var(--background)" : "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "0.3rem 0.7rem",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {autoRefresh.on ? "auto ●" : "auto ○"}
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={busy}
            style={{
              background: "transparent",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0.3rem 0.7rem",
              cursor: busy ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {busy ? "…" : "refresh"}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

// Small numeric helpers used across widgets.
export function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signColor(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return "var(--foreground)";
  return n > 0 ? "var(--accent)" : "var(--error)";
}
