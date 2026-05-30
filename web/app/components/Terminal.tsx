"use client";

import CommandBar from "./CommandBar";
import HealthChip from "./HealthChip";
import TabStrip from "./TabStrip";
import WidgetHost from "./WidgetHost";
import { useTerminal } from "../lib/useTerminal";

export default function Terminal() {
  const { tabs, activeId } = useTerminal();
  const active = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.6rem 1.25rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <strong>Omphalos</strong>
          <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>finance terminal</span>
        </div>
        <HealthChip />
      </header>

      <TabStrip tabs={tabs} activeId={activeId} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {active ? (
          // key per tab → fresh widget instance + its own data fetch
          <WidgetHost key={active.id} tab={active} />
        ) : (
          <div style={{ padding: "3rem 1.25rem", color: "var(--muted)" }}>
            <p style={{ marginBottom: "0.5rem" }}>No widgets open.</p>
            <p>
              Type a command below to begin — e.g. <code style={{ color: "var(--accent)" }}>chart AAPL</code>,{" "}
              <code style={{ color: "var(--accent)" }}>crypto BTC/USD</code>, or{" "}
              <code style={{ color: "var(--accent)" }}>help</code>.
            </p>
          </div>
        )}
      </div>

      <footer style={{ borderTop: "1px solid var(--border)", padding: "0.75rem 1.25rem" }}>
        <CommandBar />
      </footer>
    </div>
  );
}
