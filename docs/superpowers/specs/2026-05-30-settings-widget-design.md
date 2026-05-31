# Settings widget — design

**Date:** 2026-05-30
**Status:** Draft for review
**Lane:** `feat/settings-widget` (worktree `omphalos-c`)

## Goal

A Settings widget to edit **non-secret** app preferences and see account/connection
status at a glance. Opened via a `settings` command (and the header ⚙). All prefs
persist in `localStorage`; **no secret ever enters the browser** (CLAUDE.md #1/#2).

## Sections

### 1. Appearance
- **Color theme** — pick from a small set of presets that swap the app's CSS
  variables (`--background/--foreground/--accent/--panel/--border/--muted/--error`):
  - `midnight` (current dark, default), `slate` (lighter cool-gray dark), `paper` (light).
- **Text size** — `S / M / L`, scales the whole UI's text via the root font-size
  (see "Text-size mechanism" below).

### 2. Defaults
- **Default chart span / interval** — the span+interval a new `chart` opens with
  (today hardcoded to `1M`/`1h`). Reuses the existing `Span`/`Interval` enums and
  `resolveRange`.

### 3. Connections (read-only status + guidance)
- One row per source — **FRED, Kraken, IBKR** — showing a status chip
  (configured / not configured / reachable / down / log-in-needed) and a one-line
  instruction ("add `KRAKEN_API_KEY` to `api/.env`", "log in at the gateway").
- Status comes from a new **non-secret** backend endpoint `GET /status` returning
  `{ source, configured: bool, state: SourceStatus, detail: str }[]` — booleans/states
  only, **never key values**. (FRED: key present? Kraken: keys present? IBKR: gateway
  `/iserver/auth/status`.)
- **No key entry in the UI** (chosen explicitly). Keys stay an `api/.env` / gateway
  concern; this section just tells you what's missing and where to fix it.

## Architecture

**Frontend**
- `web/app/lib/appSettings.ts` (new) — `AppSettings` type (`theme`, `textSize`,
  `defaultSpan`, `defaultInterval`), defaults, pure setters, `localStorage` load/save
  with validation (mirrors `yieldPrefs.ts`).
- `web/app/lib/themes.ts` (new) — `THEMES: Record<ThemeName, Record<cssVar,string>>`
  registry + a pure `themeVars(name)` resolver. Single source of truth for theme colors.
- **Apply on load**: a tiny client effect (in `Terminal` or a `SettingsProvider`) writes
  the chosen theme's CSS vars and the text-size root font-size onto
  `document.documentElement`. SSR-safe (no flash beyond first paint; acceptable for a
  local prototype).
- `web/app/widgets/SettingsWidget.tsx` (new) — the three sections; pure presentational,
  reads/writes `appSettings` + reads `/status`.
- Command wiring: add `settings` to the parser / `WidgetKind` / `tabs` / `WidgetHost` /
  `HelpWidget` / CommandBar suggestions (same pattern every command follows).

**Backend**
- `GET /status` (new route) → per-source non-secret status, built from `config` presence
  + the IBKR auth-status probe. Maps to a new `StatusResponse` Pydantic model.

**Text-size mechanism (the broad part)**
- Convert the ~41 inline `fontSize: "<n>px"` / `"<n>rem"` across ~13 components to
  **rem** (`px / 16`), then scale `document.documentElement.style.fontSize`
  (e.g. S=14px, M=16px, L=18px). Only text scales; layout in `px` stays put.
- Mechanical, low-logic, but touches many files — done as its own commit, verified by
  build/visual check. (Spacing/density is **out of scope** for v1; same px issue, deferred.)

## Testing
- `appSettings` + `themes` — pure unit tests (defaults, setters, load validation,
  `themeVars` resolver + unknown-key fallback).
- Backend: `/status` route test (configured vs not, via a fake config/registry).
- Command tests: `settings` parses + maps to a tab (extend parser/tabs tests).
- tsc clean, vitest green, `npm run build` succeeds.

## Out of scope (YAGNI)
Custom/arbitrary color picking, per-component overrides, density/spacing scaling,
editing secrets in the UI, accent-only theming. Just: 3 theme presets, 3 text sizes,
chart defaults, and read-only connection status.
