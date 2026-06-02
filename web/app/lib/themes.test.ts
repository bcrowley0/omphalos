import { describe, expect, it } from "vitest";
import { THEMES, THEME_LABELS, themeVars, type ThemeName, type ThemeVars } from "./themes";

const NEW_THEMES: ThemeName[] = [
  "dark-paper-warm",
  "dark-paper",
  "grayscale",
  "grayscale-tonal",
  "colorblind-dark",
  "colorblind-light",
];

const VAR_KEYS: (keyof ThemeVars)[] = [
  "background",
  "foreground",
  "muted",
  "accent",
  "error",
  "panel",
  "border",
];

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("new color themes", () => {
  it("registers every new theme", () => {
    for (const name of NEW_THEMES) {
      expect(THEMES[name], `missing theme ${name}`).toBeTruthy();
    }
  });

  it("gives every theme all seven vars as valid hex colors", () => {
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const v = themeVars(name);
      for (const key of VAR_KEYS) {
        expect(v[key], `${name}.${key}`).toMatch(HEX);
      }
    }
  });

  it("keeps THEMES and THEME_LABELS in one-to-one correspondence", () => {
    expect(Object.keys(THEME_LABELS).sort()).toEqual(Object.keys(THEMES).sort());
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      expect(THEME_LABELS[name], `label for ${name}`).toBeTruthy();
    }
  });

  it("colorblind themes avoid red/green: up=blue-ish, down=orange-ish", () => {
    // Okabe-Ito safe pair — blue channel dominant for accent, red+green for orange.
    for (const name of ["colorblind-dark", "colorblind-light"] as ThemeName[]) {
      const v = themeVars(name);
      const accent = parseHex(v.accent);
      const error = parseHex(v.error);
      expect(accent.b, `${name} accent should be blue-dominant`).toBeGreaterThan(accent.r);
      expect(error.r, `${name} error should be warm`).toBeGreaterThan(error.b);
    }
  });
});

function parseHex(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
