"use client";

import { terminalStore } from "../lib/store";
import type { Tab } from "../lib/command/types";

export default function TabStrip({ tabs, activeId }: { tabs: Tab[]; activeId: string | null }) {
  if (tabs.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        gap: "0.25rem",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.5rem 0.75rem",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              background: active ? "var(--panel)" : "transparent",
              whiteSpace: "nowrap",
            }}
          >
            <button
              onClick={() => terminalStore.focus(t.id)}
              style={{
                background: "none",
                border: "none",
                color: active ? "var(--foreground)" : "var(--muted)",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.85rem",
                padding: 0,
              }}
            >
              {t.title}
            </button>
            <button
              onClick={() => terminalStore.close(t.id)}
              aria-label={`close ${t.title}`}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
