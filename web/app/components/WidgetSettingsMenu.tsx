"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Gear button + popover for per-widget settings. Generalizes the bespoke Yield
// popover: open/close, click-outside-to-close, right-aligned float under header.
// Rendered via WidgetFrame's `headerExtra` slot.
export default function WidgetSettingsMenu({
  label = "⚙",
  title = "widget settings",
  minWidth = 240,
  children,
}: {
  label?: string;
  title?: string;
  minWidth?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        style={{
          background: "transparent",
          color: "var(--foreground)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.3rem 0.7rem",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {label}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 0.4rem)",
            zIndex: 10,
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.7rem",
            minWidth,
            boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// A labeled checkbox row for boolean settings.
export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.8rem",
        padding: "0.25rem 0",
        fontSize: "0.85rem",
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  );
}
