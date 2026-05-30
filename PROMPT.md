# Kickoff: build Omphalos

Read **`CLAUDE.md`** in full first — it holds the binding rules, fixed stack, type
contract, canonical data model, and command grammar. This prompt only defines the
build sequence. When a phase references a per-source note, read the matching file
in `.claude/rules/` before writing that adapter.

Build in phases. **At the end of each phase, stop, report against its acceptance
criteria, and tell me exactly how to run and test it. Do not start the next phase
until I confirm.**

## Phase 0 — Scaffold
Monorepo: `web/` (Next.js + TS) and `api/` (FastAPI). Health-check round-trip:
frontend calls a backend `/health` through the rewrite proxy and renders the
result. `git init`; `.gitignore` (including `.env`); `api/.env.example`; README
with run instructions for both apps. Pin versions; commit lockfiles.
**Done when:** each app starts with one documented command; the frontend renders
live `/health` output through the proxy with no CORS errors; `git status` shows no
`.env`. Commit.

## Phase 1 — Framework on mock data
Adapter interface + registry + a `MockAdapter` returning fake data in the canonical
shapes. Command-bar parser and symbol router as pure, unit-tested functions.
Tabbed shell; commands open/focus widget tabs. Watchlist and open tabs persist in
`localStorage`.
**Done when:** `chart X`, `quote X`, `watch`/`unwatch X`, `port`, `yield`,
`crypto X/Y`, `news`, `help` all open populated widgets from mock data; parser and
router tests pass; an unknown command shows an inline error; a browser refresh
preserves watchlist and tabs. Commit.
*This proves the whole UX before any real API. Do not skip it.*

## Phase 2 — Easy real data (no secrets)
Implement FRED (yield curve) and Kraken public (ticker/OHLC). Wire the chart,
yield, and crypto widgets to real data through the canonical model.
**Done when:** `chart` and `crypto BTC/USD` render real candles; `yield` plots the
full tenor set with real latest values; stopping the backend shows the error state,
not a blank panel; repeated refreshes do not trip rate limits (cache works). Commit.

## Phase 3 — Kraken private (read-only)
Balances via signed requests (see `.claude/rules/kraken.md`). Key/secret from
`api/.env`.
**Done when:** `port` shows real Kraken spot balances in the canonical Balance
shape; a missing or invalid key produces the unauthenticated UI state, not a crash.
Commit.

## Phase 4 — News
Generic RSS adapter, parsed server-side. Preconfigure FT and a WSJ feed; allow
adding feed URLs at runtime. Headlines + teaser, linking out only.
**Done when:** `news` lists items with working external links; an unreachable feed
degrades gracefully; adding a feed URL at runtime works. Commit.

## Phase 5 — IBKR CP Gateway (read-only) — propose before coding
**First, post your integration approach** (session lifecycle, conid resolution,
snapshot handling, gateway-state detection) **and wait for my OK.** Then implement
portfolio positions + snapshot quotes per `.claude/rules/ibkr.md`.
**Done when:** with the gateway running and authenticated, `port` shows real IBKR
positions and `quote`/`chart` on an entitled symbol show data; with the gateway
down or logged out, the UI shows the specific actionable state ("gateway down" vs
"log in at the gateway"), never a crash; the README documents gateway setup. Commit.
