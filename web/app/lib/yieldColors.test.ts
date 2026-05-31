import { describe, expect, it } from "vitest";
import { COLOR_THEMES, themeColors } from "./yieldColors";
import type { ColorTheme } from "./yieldPrefs";

describe("themeColors", () => {
  it("resolves every theme key to a config with a non-empty palette", () => {
    for (const key of Object.keys(COLOR_THEMES) as ColorTheme[]) {
      const t = themeColors(key);
      expect(t.current).toBeTruthy();
      expect(t.palette.length).toBeGreaterThan(0);
    }
  });

  it("colors Δ cells only where the theme is semantic", () => {
    expect(themeColors("vivid").deltaSemantic).toBe(true);
    expect(themeColors("blue").deltaSemantic).toBe(true);
    expect(themeColors("gray").deltaSemantic).toBe(false); // plain gray = neutral Δ
    expect(themeColors("gray-fn").deltaSemantic).toBe(true); // gray curves, colored Δ
  });

  it("falls back to vivid for an unknown key", () => {
    expect(themeColors("bogus" as ColorTheme)).toBe(COLOR_THEMES.vivid);
  });
});
