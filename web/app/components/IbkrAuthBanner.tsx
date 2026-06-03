"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useIbkrAuth } from "./IbkrAuthProvider";
import { IbkrLoginButton, IbkrRecheckButton } from "./IbkrLoginButton";
import { ibkrBannerVisible, ibkrLoginActionable } from "../lib/ibkrAuth";

// Global "log in to IBKR" banner shown on load when the gateway is not connected.
// One-click opens the gateway login; "Re-check" re-probes; dismiss hides it for
// this session. It re-arms once connected, so a later logout shows it again.
export default function IbkrAuthBanner() {
  const { state, loginUrl, detail, loading, recheck } = useIbkrAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state === "authenticated") setDismissed(false);
  }, [state]);

  if (!ibkrBannerVisible(state) || dismissed) return null;

  return (
    <div style={bannerStyle}>
      <span style={dot} />
      <span style={{ flex: 1, color: "var(--foreground)" }}>{detail ?? "IBKR is not connected."}</span>
      {ibkrLoginActionable(state) && <IbkrLoginButton loginUrl={loginUrl} />}
      <IbkrRecheckButton onClick={recheck} loading={loading} />
      <button onClick={() => setDismissed(true)} style={dismiss} title="Dismiss" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.8rem",
  padding: "0.5rem 1.25rem",
  borderBottom: "1px solid var(--border)",
  background: "rgba(217,164,65,0.08)",
  fontSize: "0.85rem",
};

const dot: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: 999,
  background: "#d9a441",
  display: "inline-block",
  flex: "0 0 auto",
};

const dismiss: CSSProperties = {
  background: "transparent",
  color: "var(--muted)",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.9rem",
};
