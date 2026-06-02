// App-wide color themes. Each is a full set of the CSS custom properties defined
// in globals.css (:root); selecting one overrides them on document.documentElement.
// Single source of truth for app colors.

export type ThemeName =
  | "midnight"
  | "carbon"
  | "slate"
  | "paper"
  | "dark-paper-warm"
  | "dark-paper"
  | "grayscale"
  | "grayscale-tonal"
  | "colorblind-dark"
  | "colorblind-light";

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
  // Deep neutral charcoal with a warm amber accent (true-dark, no blue tint).
  carbon: {
    background: "#0c0c0c",
    foreground: "#e4e4e4",
    muted: "#808080",
    accent: "#f0a830",
    error: "#e5534b",
    panel: "#181818",
    border: "#2c2c2c",
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
  // Warm sepia "reading mode" — cream text on dark warm brown; keeps a green accent.
  "dark-paper-warm": {
    background: "#1a1612",
    foreground: "#e8dfce",
    muted: "#9a8f7d",
    accent: "#6cbf91",
    error: "#d2685c",
    panel: "#221d17",
    border: "#352d23",
  },
  // Neutral dark "paper" — flat cool charcoal, distinct from blue Midnight / black Carbon.
  "dark-paper": {
    background: "#17191b",
    foreground: "#dcdee1",
    muted: "#888b90",
    accent: "#3aa873",
    error: "#d65a50",
    panel: "#202225",
    border: "#313438",
  },
  // Pure monochrome — accent === error, so gain/loss reads from the +/- sign, not color.
  grayscale: {
    background: "#111111",
    foreground: "#e4e4e4",
    muted: "#8c8c8c",
    accent: "#c0c0c0",
    error: "#c0c0c0",
    panel: "#1a1a1a",
    border: "#2a2a2a",
  },
  // Monochrome, but direction reads by brightness: up = bright white, down = dim gray.
  "grayscale-tonal": {
    background: "#111111",
    foreground: "#e4e4e4",
    muted: "#8c8c8c",
    accent: "#f2f2f2",
    error: "#7a7a7a",
    panel: "#1a1a1a",
    border: "#2a2a2a",
  },
  // Colorblind-safe (Okabe-Ito), dark base — up = blue, down = orange; avoids red/green.
  "colorblind-dark": {
    background: "#0d1117",
    foreground: "#e6e6e6",
    muted: "#9098a3",
    accent: "#56b4e9",
    error: "#e69f00",
    panel: "#161b22",
    border: "#2a313c",
  },
  // Colorblind-safe, light base — up = blue, down = vermillion (darker for light-bg contrast).
  "colorblind-light": {
    background: "#f7f8fa",
    foreground: "#1c2330",
    muted: "#5e6678",
    accent: "#0072b2",
    error: "#d55e00",
    panel: "#ffffff",
    border: "#d9dee7",
  },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  midnight: "Midnight",
  carbon: "Carbon",
  slate: "Slate",
  paper: "Paper (light)",
  "dark-paper-warm": "Dark Paper (warm)",
  "dark-paper": "Dark Paper (neutral)",
  grayscale: "Grayscale",
  "grayscale-tonal": "Grayscale (tonal)",
  "colorblind-dark": "Colorblind (dark)",
  "colorblind-light": "Colorblind (light)",
};

export function themeVars(name: ThemeName): ThemeVars {
  return THEMES[name] ?? THEMES.midnight;
}
