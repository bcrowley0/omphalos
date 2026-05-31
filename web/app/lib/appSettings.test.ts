// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { themeVars, THEMES, type ThemeName } from "./themes";
import {
  DEFAULT_APP_SETTINGS,
  setTheme,
  setTextSize,
  loadAppSettings,
} from "./appSettings";

beforeEach(() => window.localStorage.clear());

describe("themes", () => {
  it("every theme resolves to a full var set; unknown falls back to midnight", () => {
    for (const name of Object.keys(THEMES) as ThemeName[]) {
      const v = themeVars(name);
      expect(v.background).toBeTruthy();
      expect(v.accent).toBeTruthy();
    }
    expect(themeVars("bogus" as ThemeName)).toBe(THEMES.midnight);
  });
});

describe("appSettings", () => {
  it("defaults: midnight theme, medium text", () => {
    expect(DEFAULT_APP_SETTINGS.theme).toBe("midnight");
    expect(DEFAULT_APP_SETTINGS.textSize).toBe("m");
  });

  it("setters update fields immutably", () => {
    const a = setTheme(DEFAULT_APP_SETTINGS, "paper");
    expect(a.theme).toBe("paper");
    expect(DEFAULT_APP_SETTINGS.theme).toBe("midnight"); // original unchanged
    expect(setTextSize(a, "l").textSize).toBe("l");
  });

  it("load rejects bogus persisted values and falls back to defaults", () => {
    window.localStorage.setItem(
      "omphalos.app.settings.v1",
      JSON.stringify({ theme: "bogus", textSize: "xl", defaultSpan: "99Y", defaultInterval: "9s" }),
    );
    const s = loadAppSettings();
    expect(s).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("load preserves valid persisted values", () => {
    window.localStorage.setItem(
      "omphalos.app.settings.v1",
      JSON.stringify({ theme: "slate", textSize: "l", defaultSpan: "1Y", defaultInterval: "1d" }),
    );
    expect(loadAppSettings()).toEqual({
      theme: "slate",
      textSize: "l",
      defaultSpan: "1Y",
      defaultInterval: "1d",
    });
  });
});
