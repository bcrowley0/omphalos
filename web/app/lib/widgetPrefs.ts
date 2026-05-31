"use client";

// Generic localStorage-backed per-widget UI prefs (non-secret UI state, CLAUDE.md).
// Mirrors the appSettings/yieldPrefs pattern: a pure `coerce` validates untrusted
// parsed JSON and fills defaults; load/save are the only impure parts.

import { useCallback, useState } from "react";

// Pure: turn a raw stored string (or null) into a valid prefs object.
export function coercePrefs<T>(
  raw: string | null,
  defaults: T,
  coerce: (parsed: unknown) => T,
): T {
  if (!raw) return defaults;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function readPrefs<T>(key: string, defaults: T, coerce: (parsed: unknown) => T): T {
  if (typeof window === "undefined") return defaults;
  try {
    return coercePrefs(window.localStorage.getItem(key), defaults, coerce);
  } catch {
    return defaults;
  }
}

export function writePrefs<T>(key: string, prefs: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}

// Returns [prefs, setPrefs]; setPrefs updates state AND persists synchronously.
export function useWidgetPrefs<T>(
  key: string,
  defaults: T,
  coerce: (parsed: unknown) => T,
): [T, (next: T) => void] {
  const [prefs, setState] = useState<T>(() => readPrefs(key, defaults, coerce));
  const setPrefs = useCallback(
    (next: T) => {
      setState(next);
      writePrefs(key, next);
    },
    [key],
  );
  return [prefs, setPrefs];
}
