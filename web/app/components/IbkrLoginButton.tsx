"use client";

import type { CSSProperties } from "react";

// Opens the IBKR gateway's own login page in a new tab on a real user click —
// a programmatic on-load window.open would be blocked by the popup blocker, so
// this is always click-triggered. Renders nothing until the loginUrl is known.
export function IbkrLoginButton({
  loginUrl,
  label = "Open gateway login",
}: {
  loginUrl: string | null;
  label?: string;
}) {
  if (!loginUrl) return null;
  return (
    <button
      onClick={() => window.open(loginUrl, "_blank", "noopener")}
      style={{
        background: "var(--accent)",
        color: "#0b0e14",
        border: "none",
        borderRadius: 6,
        padding: "0.3rem 0.9rem",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.82rem",
      }}
    >
      {label}
    </button>
  );
}

const recheckStyle: CSSProperties = {
  background: "transparent",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "0.25rem 0.7rem",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.8rem",
};

// "Re-check" the live auth state on demand (used after logging in at the gateway).
export function IbkrRecheckButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={recheckStyle}>
      {loading ? "…" : "Re-check"}
    </button>
  );
}
