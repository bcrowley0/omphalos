// App-wide, non-secret UI settings (theme, text size, chart defaults). Persisted
// to localStorage and applied to the document on load. Mutators + validation are
// pure; applyAppSettings / load / save are the only impure parts.

import { themeVars, THEMES, type ThemeName } from "./themes";
import { SPANS, INTERVALS, type Span, type Interval } from "./chart/range";

export type TextSize = "s" | "m" | "l";

export type AppSettings = {
  theme: ThemeName;
  textSize: TextSize;
  defaultSpan: Span;
  defaultInterval: Interval;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "midnight",
  textSize: "m",
  defaultSpan: "1M",
  defaultInterval: "1h",
};

// Root font-size per text-size tier; every rem-based font scales off this.
export const TEXT_SIZE_PX: Record<TextSize, string> = { s: "14px", m: "16px", l: "18px" };
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { s: "Small", m: "Medium", l: "Large" };

export function setTheme(s: AppSettings, theme: ThemeName): AppSettings {
  return { ...s, theme };
}
export function setTextSize(s: AppSettings, textSize: TextSize): AppSettings {
  return { ...s, textSize };
}
export function setDefaultSpan(s: AppSettings, defaultSpan: Span): AppSettings {
  return { ...s, defaultSpan };
}
export function setDefaultInterval(s: AppSettings, defaultInterval: Interval): AppSettings {
  return { ...s, defaultInterval };
}

// Impure: write the theme's CSS variables and the root font-size onto the document.
export function applyAppSettings(s: AppSettings): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const v = themeVars(s.theme);
  el.style.setProperty("--background", v.background);
  el.style.setProperty("--foreground", v.foreground);
  el.style.setProperty("--muted", v.muted);
  el.style.setProperty("--accent", v.accent);
  el.style.setProperty("--error", v.error);
  el.style.setProperty("--panel", v.panel);
  el.style.setProperty("--border", v.border);
  el.style.fontSize = TEXT_SIZE_PX[s.textSize];
}

const STORAGE_KEY = "omphalos.app.settings.v1";

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const p = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: typeof p.theme === "string" && p.theme in THEMES ? (p.theme as ThemeName) : "midnight",
      textSize: p.textSize === "s" || p.textSize === "m" || p.textSize === "l" ? p.textSize : "m",
      defaultSpan: SPANS.includes(p.defaultSpan as Span) ? (p.defaultSpan as Span) : "1M",
      defaultInterval: INTERVALS.includes(p.defaultInterval as Interval)
        ? (p.defaultInterval as Interval)
        : "1h",
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(s: AppSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable / quota — non-fatal for a local-first prototype */
  }
}
