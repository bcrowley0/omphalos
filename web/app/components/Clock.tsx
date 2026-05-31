"use client";

import { useEffect, useState } from "react";

// Live local date + time for the top bar. Renders nothing until mounted (so the
// server/client first paint can't mismatch), then ticks once a second.
export default function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Client-only mount init: the first paint is null (above) to avoid an
    // SSR/client hydration mismatch, so seeding the time here is intentional —
    // the lint rule can't see past that, mirroring the suppression in useResource.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return (
    <span
      title={now.toLocaleString()}
      style={{ color: "var(--muted)", fontSize: "0.78rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
    >
      {date} {time}
    </span>
  );
}
