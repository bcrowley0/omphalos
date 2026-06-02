"use client";

import { useEffect, useRef, useState } from "react";
import { terminalStore } from "../lib/store";
import { useTerminal } from "../lib/useTerminal";

// Popular commands surfaced in the focus menu. `needsArg` commands prefill the
// verb and wait for the user's argument; argless ones dispatch immediately.
type Suggestion = { verb: string; label: string; hint: string; needsArg: boolean };
const SUGGESTIONS: Suggestion[] = [
  { verb: "help", label: "help", hint: "command list", needsArg: false },
  { verb: "following", label: "following", hint: "people you follow", needsArg: false },
  { verb: "news", label: "news", hint: "headlines — FT, WSJ, Bloomberg", needsArg: false },
  { verb: "yield", label: "yield", hint: "Treasury yield curve", needsArg: false },
  { verb: "port", label: "port", hint: "portfolio", needsArg: false },
  { verb: "chart", label: "chart <SYMBOL>", hint: "price chart — AAPL or BTC/USD", needsArg: true },
  { verb: "quote", label: "quote <SYMBOL>", hint: "snapshot quote — AAPL or BTC", needsArg: true },
  { verb: "follow", label: "follow <name>", hint: "follow a person", needsArg: true },
  { verb: "watchlist", label: "watchlist", hint: "open the watchlist", needsArg: false },
  { verb: "watch", label: "watch <SYMBOL>", hint: "add to watchlist (bare: open it)", needsArg: true },
  { verb: "cal", label: "cal", hint: "economic calendar", needsArg: false },
  { verb: "settings", label: "settings", hint: "theme, text size, connections", needsArg: false },
];

export default function CommandBar() {
  const { error, history } = useTerminal();
  const [input, setInput] = useState("");
  // Index into history for ↑/↓ recall; == history.length means "new line".
  const [histIdx, setHistIdx] = useState(history.length);
  const [focused, setFocused] = useState(false);
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

  // Suggestions menu: open while focused and still choosing a verb (no space
  // typed yet). Filters by verb prefix or hint text.
  const query = input.trim().toLowerCase();
  const typingArgs = input.includes(" ");
  const matches = typingArgs
    ? []
    : SUGGESTIONS.filter((s) => !query || s.verb.startsWith(query) || s.hint.toLowerCase().includes(query));
  const menuOpen = focused && matches.length > 0;

  function submit() {
    const value = input.trim();
    if (!value) return;
    terminalStore.dispatch(value);
    setInput("");
    setHistIdx(history.length + 1); // reset to end (this entry just appended)
  }

  function select(s: Suggestion) {
    if (s.needsArg) {
      setInput(`${s.verb} `);
      inputRef.current?.focus();
    } else {
      terminalStore.dispatch(s.verb);
      setInput("");
      setHistIdx(history.length + 1);
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      submit();
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
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
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ color: "var(--accent)" }}>›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="type a command"
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

      {menuOpen && (
        // preventDefault on mousedown keeps the input focused so the click lands
        // before the blur would close the menu.
        <ul
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: "0.4rem",
            width: "max-content",
            minWidth: 320,
            maxWidth: "90vw",
            listStyle: "none",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.3rem",
            zIndex: 50,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          {matches.map((s) => (
            <li key={s.verb}>
              <button
                onClick={() => select(s)}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "1.5rem",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  borderRadius: 6,
                  padding: "0.4rem 0.6rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "0.85rem",
                  textAlign: "left",
                  color: "var(--foreground)",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--background)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <code style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>{s.label}</code>
                <span style={{ color: "var(--muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>{s.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--error)", marginTop: "0.4rem", fontSize: "0.85rem" }}>
          ✕ {error}
        </p>
      )}
    </div>
  );
}
