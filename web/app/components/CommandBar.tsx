"use client";

import { useEffect, useRef, useState } from "react";
import { terminalStore } from "../lib/store";
import { useTerminal } from "../lib/useTerminal";

export default function CommandBar() {
  const { error, history } = useTerminal();
  const [input, setInput] = useState("");
  // Index into history for ↑/↓ recall; == history.length means "new line".
  const [histIdx, setHistIdx] = useState(history.length);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard-first: ⌘K / Ctrl-K focuses the command bar from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit() {
    const value = input.trim();
    if (!value) return;
    terminalStore.dispatch(value);
    setInput("");
    setHistIdx(history.length + 1); // reset to end (this entry just appended)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.max(0, (histIdx === history.length ? history.length : histIdx) - 1);
      setHistIdx(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(history.length, histIdx + 1);
      setHistIdx(next);
      setInput(next === history.length ? "" : history[next] ?? "");
    } else if (error) {
      terminalStore.clearError();
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: "var(--accent)" }}>›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="type a command — try: help"
          spellCheck={false}
          autoComplete="off"
          aria-label="command bar"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
            fontFamily: "inherit",
            fontSize: "1rem",
          }}
        />
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--error)", marginTop: "0.4rem", fontSize: "0.85rem" }}>
          ✕ {error}
        </p>
      )}
    </div>
  );
}
