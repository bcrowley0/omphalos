import type { ColorTheme } from "./yieldPrefs";

// A color theme for the yield-curve overlays. `current` colors the "today" curve;
// `palette` is cycled across the comparison curves; `deltaSemantic` decides whether
// Δ table cells are colored green/red (up/down) or rendered neutral.
export type ThemeConfig = {
  label: string;
  current: string;
  palette: string[];
  deltaSemantic: boolean;
};

const GRAY_RAMP = ["#c3cad6", "#9aa3b3", "#767f90", "#dfe4ec", "#aab2c0", "#646d7d"];

// Single source of truth for overlay colors. Saturated colors pop on the dark
// background; the mono themes (blue/gray) ramp lightness so curves stay separable.
export const COLOR_THEMES: Record<ColorTheme, ThemeConfig> = {
  vivid: {
    label: "Vivid",
    current: "#ffffff",
    palette: ["#4c8dff", "#f5b833", "#ff5fb4", "#a06bff", "#ff8a3d", "#2bc8d4"],
    deltaSemantic: true,
  },
  blue: {
    label: "Blue scale",
    current: "#ffffff",
    palette: ["#9ec5ff", "#4c8dff", "#2f6fe0", "#7cc4ff", "#3aa0e6", "#1f4fb0"],
    deltaSemantic: true,
  },
  gray: {
    label: "Gray scale",
    current: "#ffffff",
    palette: GRAY_RAMP,
    deltaSemantic: false,
  },
  "gray-fn": {
    label: "Gray + Δ color",
    current: "#ffffff",
    palette: GRAY_RAMP,
    deltaSemantic: true,
  },
};

// Resolve a theme key to its config, falling back to the default (vivid).
export function themeColors(theme: ColorTheme): ThemeConfig {
  return COLOR_THEMES[theme] ?? COLOR_THEMES.vivid;
}
