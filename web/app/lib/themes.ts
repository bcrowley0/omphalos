// App-wide color themes. Each is a full set of the CSS custom properties defined
// in globals.css (:root); selecting one overrides them on document.documentElement.
// Single source of truth for app colors.

export type ThemeName = "midnight" | "slate" | "paper";

export type ThemeVars = {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  error: string;
  panel: string;
  border: string;
};

export const THEMES: Record<ThemeName, ThemeVars> = {
  // Current dark default.
  midnight: {
    background: "#0b0e14",
    foreground: "#d7dce5",
    muted: "#7a8699",
    accent: "#4cc38a",
    error: "#e5534b",
    panel: "#141925",
    border: "#232b3a",
  },
  // Lighter cool-gray dark.
  slate: {
    background: "#1b2030",
    foreground: "#dfe5ef",
    muted: "#9aa6bd",
    accent: "#6fb1ff",
    error: "#f0726a",
    panel: "#262d40",
    border: "#3a4357",
  },
  // Light.
  paper: {
    background: "#f6f7f9",
    foreground: "#1c2330",
    muted: "#5e6678",
    accent: "#1f8f5f",
    error: "#c63b32",
    panel: "#ffffff",
    border: "#d9dee7",
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  midnight: "Midnight",
  slate: "Slate",
  paper: "Paper (light)",
};

export function themeVars(name: ThemeName): ThemeVars {
  return THEMES[name] ?? THEMES.midnight;
}
