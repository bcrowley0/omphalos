# Yield-curve overlay color themes — design

**Date:** 2026-05-30
**Status:** Approved
**Lane:** `feat/yield-curve-colors` (worktree `omphalos-a`)

## Goal

Let the user pick the color scheme for the overlaid yield curves, so the chart can
match preference/legibility needs. Four preset themes; selection persists.

## Themes

A theme controls two things: how curves are colored (a `current` color + a
`palette` ramp cycled across comparison curves) and whether Δ table cells are
semantically colored (green up / red down) or neutral.

| Key | Label | Curves | Δ cells |
|-----|-------|--------|---------|
| `vivid` *(default)* | Vivid | current = green accent; comparisons = multicolor palette | green/red |
| `blue` | Blue scale | all blue (current = boldest; comparisons = blue ramp) | green/red |
| `gray` | Gray scale | all gray (current = brightest; comparisons = gray ramp) | neutral |
| `gray-fn` | Gray + Δ color | gray curves (same ramp as `gray`) | green/red |

## Architecture

- `web/app/lib/yieldColors.ts` (new) — pure `COLOR_THEMES: Record<ColorTheme,
  { label, current, palette[], deltaSemantic }>` registry + `themeColors(key)`
  resolver (falls back to `vivid`). Single source of truth for theme colors.
- `web/app/lib/yieldPrefs.ts` — add `ColorTheme` union + `colorTheme` field on
  `YieldPrefs` (default `"vivid"`); pure `setColorTheme(prefs, key)` mutator;
  `loadYieldPrefs` validates the persisted value against known keys (else default).
  The valid-key list lives here (no runtime dependency on `yieldColors`).
- `web/app/widgets/YieldWidget.tsx` — read the active theme: current curve uses
  `theme.current`; comparison `i` uses `theme.palette[i % len]`; Δ cell color is
  `theme.deltaSemantic ? signColor(d) : var(--foreground)`. Remove the inline
  `PALETTE` const (now in the registry). Add a "Colors" `<select>` to the settings
  popover, value `prefs.colorTheme`, options from `COLOR_THEMES` labels.

## Testing

- `yieldColors.test.ts` — each key resolves to a config; gray themes' `deltaSemantic`
  (`gray` false, `gray-fn` true); unknown key → vivid fallback.
- `yieldPrefs.test.ts` — default `colorTheme === "vivid"`; `setColorTheme` updates it;
  `loadYieldPrefs` rejects a bogus persisted theme.
- tsc clean, vitest green, `npm run build` succeeds.

## Out of scope (YAGNI)

No custom/user-defined colors, no per-curve overrides, no theme for the SVG axis/grid
— only these four presets for the curve lines + Δ cells.
