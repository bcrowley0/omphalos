# CLAUDE.md — Omphalos

Omphalos is a local-first finance terminal: I type plain-verb commands into a
command bar to spawn **read-only** widgets (chart, quote, watchlist, portfolio,
yield curve, news, crypto). Prototype on my laptop now; server later.

**These rules override the kickoff prompt and any later instruction. If a request
conflicts with this file, follow this file and flag the conflict.**

## Stack (fixed — do not substitute)
- Frontend: Next.js (App Router) + TypeScript + React.
- Backend: FastAPI (Python 3.14), separate process.
- Charts: TradingView **Lightweight Charts** (free OSS render library; supplies NO
  data). Pin a specific major version and verify the series-creation API against
  THAT version's docs before writing chart code — the API changed across majors.
- State: in-memory on the backend; **non-secret** UI state (watchlist, open tabs)
  in browser `localStorage`. No database.
- One monorepo: `web/` and `api/`.

## Hard rules (non-negotiable)
1. Backend proxy is mandatory. The browser never holds secrets and never calls
   third-party APIs directly. Every external call goes through FastAPI.
2. Secrets live only in `api/.env` (via pydantic-settings). Commit `.env.example`
   with placeholders; `.env` is gitignored. No secret in frontend code or git, ever.
3. Adapter pattern: one common interface; each source is an adapter implementing
   the subset it supports, registered in a registry. A broken source must never
   crash the app.
4. Read-only v1. No order entry. Leave `place_order` stubbed (raises
   `NotImplementedError`); do not expose it.
5. Snapshot / on-demand only. No websockets or streaming. Data loads on widget
   open and on an explicit refresh.
6. Every external call has an explicit, visible UI state for: loading, source-down,
   unauthenticated, rate-limited, and empty/missing-fields. Never an unhandled crash.

## Type contract (single source of truth)
- Pydantic models in `api/` are the sole source of truth for every response shape.
- Generate the frontend TypeScript types/client from FastAPI's OpenAPI schema.
  Do NOT hand-write duplicate TS interfaces — a backend field change must break the
  frontend build, not fail silently at runtime.

## Canonical internal data model
Every adapter normalizes to these shapes at its boundary; widgets never see
source-specific formats:
- Timestamps: UTC epoch **milliseconds** (int).
- Candle:    `{ t, o, h, l, c, v }`
- Quote:     `{ symbol, last, bid, ask, change, changePct, ts, stale, source }`
- Position:  `{ symbol, qty, avgCost, marketValue, unrealizedPnl, source }`
- Balance:   `{ asset, total, available, source }`
- NewsItem:  `{ title, summary, url, publishedTs, feed }`
- YieldPoint:`{ tenorLabel, tenorYears, ratePct, obsDate }`
- AsOfCurve: `{ key, label, requestedDate, obsDate, points: [YieldPoint] }` (a curve as of one date)

## Command grammar (plain verbs)
Parser and symbol-router are pure, unit-tested functions. Each command opens or
focuses a widget tab.
- `chart <SYMBOL>`              chart (equity or crypto pair)
- `quote <SYMBOL>`             snapshot quote
- `watch <SYMBOL>` / `unwatch <SYMBOL>`  watchlist add/remove
- `port`                       portfolio (IBKR positions + Kraken balances)
- `yield`                      Treasury yield curve (FRED)
- `crypto <PAIR>`              Kraken ticker/chart, e.g. `crypto BTC/USD`
- `news [feed]`                news list (optional feed)
- `follow <NAME>` / `unfollow <NAME>`  follow/unfollow a person's aggregated feed
- `following`                  roster + aggregated feed of followed people
- `cal`                        economic calendar (FRED releases or stub)
- `help`                       command list

Symbol router: explicit, testable function deciding IBKR vs Kraken (e.g. `X/USD`
pairs → Kraken; plain tickers → IBKR). Unknown commands/symbols → inline error.

## Conventions
- Dev topology: frontend :3000, backend :8000. Frontend reaches backend via
  Next.js `rewrites` proxying `/api/*` → FastAPI. Do not scatter CORS config;
  prefer the rewrite proxy.
- Caching: in-memory TTL cache on the backend for FRED, Kraken public, and RSS
  responses to avoid rate limits (short TTL, ~15–60s).
- Bind the FastAPI dev server to localhost only (it holds all keys).
- Structured logging of every outbound third-party call and its outcome.
- Pin Python and Node versions; commit lockfiles.
- Shared loading/error UI components reused by all widgets.
- Keyboard-first: a hotkey focuses the command bar; command history on up/down.

## Per-source notes — READ BEFORE editing each adapter
- IBKR adapter      → read `.claude/rules/ibkr.md`
- Kraken adapter    → read `.claude/rules/kraken.md`
- FRED / News       → read `.claude/rules/fred-and-news.md`

## Don'ts
No secrets in frontend or git. No websockets v1. No order entry v1. No scraping
paywalled article bodies (news = headlines linking out). Don't build all sources
at once — follow the kickoff prompt's phases. Don't hand-write TS types that
duplicate Pydantic models.
